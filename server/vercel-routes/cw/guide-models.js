import { cwGraphqlRequest, readJsonBody } from './shared.js';

function parseMaybeJson(value) {
  let current = value;
  for (let i = 0; i < 6; i += 1) {
    if (typeof current !== 'string') return current;
    try {
      current = JSON.parse(current);
    } catch {
      return current;
    }
  }
  return current;
}

function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeCode(value) {
  return cleanText(value).toUpperCase();
}

function normalizeVariant(value) {
  const raw = cleanText(value).toLowerCase();
  return raw === 'back' || raw === 'side' ? raw : 'front';
}

function pickText(value) {
  const parsed = parseMaybeJson(value);
  if (typeof parsed === 'string') return cleanText(parsed);
  if (parsed && typeof parsed === 'object') {
    return cleanText(parsed.en || parsed.un || parsed.UN || parsed.label || '');
  }
  return cleanText(parsed);
}

function toFilePrefix(variant) {
  if (variant === 'back') return 'Back_';
  if (variant === 'side') return 'Side_';
  return 'Front_';
}

function extractEnglishRuleMessage(rule, code) {
  const parsedRule = parseMaybeJson(rule);
  const message = parseMaybeJson(parsedRule?.message);
  const english = cleanText(message?.en || message?.un || message?.UN || '');
  if (!english) return '';

  const escapedCode = String(code || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleanText(
    english
      .replace(new RegExp(`^${escapedCode}\\s+is\\s+too\\s+(?:small|big)\\.\\s*`, 'i'), '')
      .replace(
        new RegExp(`^${escapedCode}\\s+cannot\\s+be\\s+bigger\\s+than\\s+`, 'i'),
        'Cannot be bigger than '
      )
      .replace(/^This seems to be too (?:small|big)[^.]*\.\s*/i, '')
  );
}

function scoreHint(message) {
  const text = cleanText(message).toLowerCase();
  if (!text) return -100;
  let score = 0;
  if (/\bmeasure|measured|measuring\b/.test(text)) score += 6;
  if (/\bfrom\b/.test(text)) score += 4;
  if (/\bcurve|frame|seat|arm|width|depth|height|diameter\b/.test(text)) score += 3;
  if (/\bshould\b/.test(text)) score += 2;
  if (/\bcontact us\b/.test(text)) score -= 6;
  if (/\bnormal sized sofa|armchair instead|sectional instead\b/.test(text)) score -= 4;
  return score;
}

function extractMeasurementRows(fileContent) {
  if (!fileContent || typeof fileContent !== 'object') return [];
  const fieldContent = parseMaybeJson(fileContent.field_content);
  const fieldOrder = Array.isArray(fileContent.field_order) ? fileContent.field_order : [];
  const orderedKeys = fieldOrder.length
    ? fieldOrder.map(key => cleanText(key)).filter(Boolean)
    : Object.keys(fieldContent || {});

  return orderedKeys
    .map(key => {
      const rawField = fieldContent?.[key];
      const field = parseMaybeJson(rawField);
      const rules = Array.isArray(field?.rule) ? field.rule : [];
      const candidates = rules
        .map(rule => extractEnglishRuleMessage(rule, key))
        .filter(Boolean)
        .sort((a, b) => scoreHint(b) - scoreHint(a));
      const hint = candidates[0] || '';
      if (!hint || scoreHint(hint) < 1) return null;
      return {
        key,
        unit: cleanText(field?.unit || ''),
        hint,
      };
    })
    .filter(Boolean);
}

function mapModelRow(row, requestedVariant) {
  const code = normalizeCode(row?.modelName);
  const variant = normalizeVariant(requestedVariant);
  const data = parseMaybeJson(row?.modelData);
  const fileContent =
    data?.file_content && typeof data.file_content === 'object' ? data.file_content : {};
  const filePrefix = toFilePrefix(variant);
  const matchingEntry = Object.entries(fileContent).find(([name]) =>
    String(name || '').startsWith(filePrefix)
  );
  const activeView = matchingEntry ? parseMaybeJson(matchingEntry[1]) : null;

  return {
    code,
    variant,
    name: pickText(data?.name),
    description: pickText(data?.description),
    viewLabel: pickText(activeView?.label) || `${variant[0].toUpperCase()}${variant.slice(1)} View`,
    measurements: extractMeasurementRows(activeView),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const selections = Array.isArray(body?.selections) ? body.selections : [];
    const normalizedSelections = selections
      .map(item => ({
        code: normalizeCode(item?.code),
        variant: normalizeVariant(item?.variant),
      }))
      .filter(item => item.code);

    if (!normalizedSelections.length) {
      return res
        .status(400)
        .json({ success: false, message: 'No guide model selections provided' });
    }

    const gql = await cwGraphqlRequest({
      operationName: 'GuideModelList',
      query: `
        query GuideModelList {
          mtModelNamesList {
            id
            modelName
            label
            modelData
          }
        }
      `,
    });

    const rows = Array.isArray(gql?.body?.data?.mtModelNamesList)
      ? gql.body.data.mtModelNamesList
      : [];
    const rowMap = new Map(rows.map(row => [normalizeCode(row?.modelName), row]));

    const models = normalizedSelections.map(selection => {
      const row = rowMap.get(selection.code);
      if (!row) {
        return {
          code: selection.code,
          variant: selection.variant,
          missing: true,
          measurements: [],
        };
      }
      return mapModelRow(row, selection.variant);
    });

    return res.status(gql.ok ? 200 : 502).json({
      success: gql.ok,
      models,
      upstreamStatus: gql.status,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Guide model lookup failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
