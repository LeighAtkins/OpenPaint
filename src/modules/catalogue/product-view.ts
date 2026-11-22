import {
  renderOverallSvg,
  dimensionLabel,
  dimensionKeys,
  type OverallPlacement,
  type Dimensions,
  type Unit,
} from './overall-dimensions';
import { coversForProduct, overallForProduct, type CatalogueProduct } from './bridge';
export function mountCataloguePreview(
  container: HTMLElement,
  item: CatalogueProduct,
  onPlacement?: (placement: OverallPlacement) => void
) {
  const image = document.createElement('img');
  image.src = item.imageUrl;
  image.alt = item.productReference + ' catalogue photograph';
  image.style.cssText = 'width:100%;height:auto;display:block;';
  const drawing = document.createElement('div');
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;';
  const unit = document.createElement('select');
  unit.setAttribute('aria-label', 'Overall dimension units');
  unit.innerHTML = '<option value="cm">Centimetres</option><option value="in">Inches</option>';
  const state = document.createElement('p');
  state.setAttribute('role', 'status');
  state.style.cssText = 'font-size:12px;line-height:1.5;';
  let placement: OverallPlacement | undefined;
  let size = { width: 1000, height: 1000 };
  const render = () => {
    if (placement)
      drawing.innerHTML = renderOverallSvg(
        placement,
        item.dimensions as Dimensions,
        unit.value as Unit,
        item.imageUrl,
        size
      );
    state.textContent =
      dimensionKeys
        .map(key => dimensionLabel(item.dimensions as Dimensions, key, unit.value as Unit))
        .join(' · ') + (placement ? ' · AI placement: review the outer edges.' : '');
  };
  unit.addEventListener('change', render);
  drawing.append(image);
  controls.append(unit);
  container.append(drawing, controls, state);
  render();
  const task = overallForProduct(item)
    .then(result => {
      placement = result.placement;
      size = result.imageSize;
      render();
      onPlacement?.(result.placement);
      if (result.placement.omissions.length)
        state.textContent +=
          ' ' + result.placement.omissions.map(o => `${o.key}: ${o.reason}`).join(' ');
      return result;
    })
    .catch(error => {
      state.textContent += ' ' + error.message;
      return null;
    });
  return { task, getPlacement: () => placement };
}
export function mountCatalogueCovers(container: HTMLElement, item: CatalogueProduct) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = "What's in the box";
  details.append(summary);
  container.append(details);
  let loaded = false;
  details.addEventListener('toggle', () => {
    if (!details.open || loaded) return;
    loaded = true;
    const status = document.createElement('p');
    status.textContent = 'Loading cover diagrams for the selected PID and style…';
    status.setAttribute('role', 'status');
    details.append(status);
    void coversForProduct(item)
      .then(({ components }) => {
        status.textContent = `${item.measurementReference} · ${item.measurementStyleCode} · Contents per set`;
        for (const component of components) {
          const heading = document.createElement('p');
          heading.textContent = `${component.quantity} × ${component.name}`;
          details.append(heading);
          if (!component.images.length) {
            const note = document.createElement('p');
            note.textContent = 'No image supplied for this component.';
            details.append(note);
          }
          for (const asset of component.images) {
            if (!asset.url) {
              const note = document.createElement('p');
              note.textContent = component.name + ': diagram could not load.';
              details.append(note);
              continue;
            }
            const image = document.createElement('img');
            image.src = asset.url;
            image.alt = asset.name || component.name;
            image.style.cssText =
              'width:100%;max-height:380px;object-fit:contain;background:white;border:1px solid #ddd;border-radius:8px;margin:4px 0 12px;';
            details.append(image);
          }
        }
      })
      .catch(error => {
        status.textContent = error.message;
        loaded = false;
      });
  });
}
