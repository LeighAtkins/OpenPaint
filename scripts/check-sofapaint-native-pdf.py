"""Read-only native PDF validation, including an in-memory fill/save round trip."""
import argparse
import hashlib
import io
import json
import math
from pathlib import Path

from pypdf import PdfReader, PdfWriter

parser = argparse.ArgumentParser()
parser.add_argument('pdf', type=Path)
parser.add_argument('private_state', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
source = args.pdf.read_bytes()
before = hashlib.sha256(source).hexdigest()
state = json.loads(args.private_state.read_text(encoding='utf-8'))
placement = state['placement']
expected = {}
for image in state['images']:
    rows = [m for m in placement['measurements'] if m['imageId'] == image['id']]
    for index, row in enumerate(rows):
        if row.get('value', '').strip():
            raise ValueError('Pilot must not contain estimated measurement values.')
        expected[f"measurement_{image['id']}_{index}"] = row['label']
report = dict(status='running', sha256=before, claimsPhysicalAccuracy=False)
try:
    reader = PdfReader(io.BytesIO(source))
    if reader.is_encrypted or len(reader.pages) != len(state['images']):
        raise ValueError('Unexpected encryption or page count.')
    subject = str(reader.metadata.get('/Subject', ''))
    if not subject.startswith('SOFAPAINT_REVIEW_V1:'):
        raise ValueError('Native review manifest missing.')
    manifest = json.loads(subject.removeprefix('SOFAPAINT_REVIEW_V1:'))
    if manifest['unit'] != 'cm':
        raise ValueError('Unexpected units.')
    for image, view in zip(state['images'], manifest['views'], strict=True):
        wanted = [dict(label=m['label'], value='') for m in placement['measurements'] if m['imageId'] == image['id']]
        if view['viewId'] != image['id'] or view['title'] != image['view'].upper() or view['measurements'] != wanted:
            raise ValueError('Native PDF manifest does not match the reviewed placement.')
    fields = reader.get_fields() or {}
    text_fields = {name: field for name, field in fields.items() if field.get('/FT') == '/Tx'}
    if set(text_fields) != set(expected) or any(str(f.get('/V', '')) for f in text_fields.values()):
        raise ValueError('Missing, extra or nonblank measurement fields.')
    units = {name: field for name, field in fields.items() if name.startswith('unit_measurement_')}
    if len(units) != len(state['images']) or any(str(f.get('/V')) != '/0' for f in units.values()):
        raise ValueError('Per-page centimetre selection is missing or inconsistent.')
    canonical = {}
    for ref in reader.trailer['/Root']['/AcroForm']['/Fields']:
        field = ref.get_object()
        name = str(field.get('/T', ''))
        if not name or name in canonical:
            raise ValueError('Missing or duplicated canonical field name.')
        canonical[name] = (ref.idnum, ref.generation)
    widgets = []
    for page_index, page in enumerate(reader.pages):
        for ref in page.get('/Annots', []):
            widget = ref.get_object()
            if widget.get('/Subtype') != '/Widget':
                continue
            owner_ref = widget.get('/Parent', ref)
            owner = owner_ref.get_object()
            name = str(owner.get('/T', ''))
            if canonical.get(name) != (owner_ref.idnum, owner_ref.generation):
                raise ValueError('Widget is not connected to its canonical AcroForm field.')
            effective_value = widget.get('/V', owner.get('/V', ''))
            if str(effective_value) != str(fields[name].get('/V', '')):
                raise ValueError('Widget and canonical field values disagree.')
            rect = [float(n) for n in widget['/Rect']]
            if (len(rect) != 4 or not all(math.isfinite(n) for n in rect)
                    or rect[0] < 0 or rect[1] < 0 or rect[2] > float(page.mediabox.width)
                    or rect[3] > float(page.mediabox.height) or rect[2] <= rect[0] or rect[3] <= rect[1]):
                raise ValueError('Widget is clipped or invalid.')
            appearance = widget.get('/AP', {}).get('/N')
            if appearance is None:
                raise ValueError('Widget normal appearance is missing.')
            appearance = appearance.get_object()
            if hasattr(appearance, 'get_data') and not appearance.get_data():
                raise ValueError('Empty widget appearance.')
            widgets.append(dict(page=page_index + 1, name=name, rect=rect))
    if sum(w['name'] in expected for w in widgets) != len(expected):
        raise ValueError('Measurement widget count does not match canonical fields.')
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    values = {name: f'QA-{index + 1}' for index, name in enumerate(expected)}
    writer.update_page_form_field_values(None, values, auto_regenerate=False)
    memory = io.BytesIO()
    writer.write(memory)
    saved = PdfReader(io.BytesIO(memory.getvalue()))
    saved_fields = saved.get_fields() or {}
    if any(str(saved_fields[name].get('/V')) != value for name, value in values.items()):
        raise ValueError('In-memory fill/save round trip failed.')
    for page in saved.pages:
        for ref in page.get('/Annots', []):
            widget = ref.get_object()
            owner = widget.get('/Parent', ref).get_object()
            name = str(owner.get('/T', ''))
            if name not in values:
                continue
            if str(widget.get('/V', owner.get('/V', ''))) != values[name] or not widget['/AP']['/N'].get_object().get_data():
                raise ValueError('Saved widget value or appearance did not update.')
    if hashlib.sha256(args.pdf.read_bytes()).hexdigest() != before:
        raise ValueError('Source PDF changed during read-only QA.')
    report.update(status='passed', pages=len(reader.pages), measurementFields=len(expected),
                  unitGroups=len(units), widgets=widgets, fillSaveRoundTrip=True,
                  originalMeasurementsBlank=True, sourceUnchanged=True)
except Exception as error:
    report.update(status='failed', error=str(error))
    raise
finally:
    with args.output.open('x', encoding='utf-8') as output:
        json.dump(report, output, indent=2)
    print(json.dumps({k: v for k, v in report.items() if k != 'widgets'}))
