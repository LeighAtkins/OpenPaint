import { evaluateSofaRules, getProjectMetadata, mergeRuleParams } from '../sofa-rule-engine.js';

function ensureStyles() {
  if (document.getElementById('sofaRuleReviewStyles')) return;
  const style = document.createElement('style');
  style.id = 'sofaRuleReviewStyles';
  style.textContent = `
    .sofa-rule-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.58); z-index: 12600; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .sofa-rule-card { width: min(900px, 100%); max-height: 88vh; overflow: auto; background: #fff; border-radius: 16px; box-shadow: 0 24px 45px rgba(15,23,42,.25); padding: 20px; }
    .sofa-rule-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .sofa-rule-title { margin: 0; color: #0f172a; font-size: 22px; }
    .sofa-rule-sub { margin: 4px 0 0; color: #475569; font-size: 13px; }
    .sofa-rule-badge { font-size: 11px; font-weight: 700; letter-spacing: .03em; border-radius: 999px; padding: 3px 8px; text-transform: uppercase; }
    .sofa-rule-badge.pass { background: #dcfce7; color: #166534; }
    .sofa-rule-badge.warn { background: #fef3c7; color: #92400e; }
    .sofa-rule-badge.fail { background: #fee2e2; color: #991b1b; }
    .sofa-rule-item { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; margin-bottom: 8px; }
    .sofa-rule-item h4 { margin: 0; font-size: 14px; color: #0f172a; display: flex; justify-content: space-between; }
    .sofa-rule-item p { margin: 8px 0 0; font-size: 12px; color: #334155; }
    .sofa-rule-actions { margin-top: 8px; padding-left: 16px; color: #475569; font-size: 12px; }
    .sofa-rule-footer { margin-top: 14px; display: flex; justify-content: flex-end; }
    .sofa-rule-btn { border-radius: 9px; border: 1px solid #cbd5e1; background: #fff; color: #334155; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
  `;
  document.head.appendChild(style);
}

function openSofaRuleReview() {
  const metadata = getProjectMetadata();
  const result = evaluateSofaRules(metadata, mergeRuleParams(metadata));

  ensureStyles();
  const overlay = document.createElement('div');
  overlay.className = 'sofa-rule-overlay';

  const checksHtml = result.checks
    .map(
      check => `
      <article class="sofa-rule-item">
        <h4>
          <span>${check.id} - ${check.label}</span>
          <span class="sofa-rule-badge ${check.status}">${check.status}</span>
        </h4>
        <p>${check.message}</p>
        ${check.actions?.length ? `<ul class="sofa-rule-actions">${check.actions.map(action => `<li>${action.type}${action.slot ? `: ${action.slot}` : ''}${action.prompt ? ` — ${action.prompt}` : ''}</li>`).join('')}</ul>` : ''}
      </article>
    `
    )
    .join('');

  overlay.innerHTML = `
    <section class="sofa-rule-card" role="dialog" aria-modal="true" aria-label="Sofa relationship checks">
      <div class="sofa-rule-top">
        <div>
          <h2 class="sofa-rule-title">Sofa Relationship Checks</h2>
          <p class="sofa-rule-sub">Run validation and follow-up request generation from current project metadata.</p>
        </div>
        <span class="sofa-rule-badge ${result.overallStatus}">${result.overallStatus}</span>
      </div>

      ${checksHtml}

      <div class="sofa-rule-footer">
        <button class="sofa-rule-btn" id="closeSofaRuleReview" type="button">Close</button>
      </div>
    </section>
  `;

  const close = () => overlay.remove();
  overlay.querySelector('#closeSofaRuleReview')?.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });

  document.body.appendChild(overlay);
  return result;
}

function installLauncher() {
  if (document.getElementById('openSofaRuleReviewBtn')) return;
  const controls = document.getElementById('elementsControls');
  if (!controls) return;

  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.innerHTML =
    '<button id="openSofaRuleReviewBtn" type="button" class="w-full px-2 py-1 text-xs bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors">Run Sofa Checks</button>';
  controls.appendChild(wrap);
  wrap
    .querySelector('#openSofaRuleReviewBtn')
    ?.addEventListener('click', () => window.openSofaRuleReview?.());
}

export function initSofaRuleReview() {
  window.evaluateSofaRules = input => {
    const metadata = input || getProjectMetadata();
    return evaluateSofaRules(metadata, mergeRuleParams(metadata));
  };
  window.openSofaRuleReview = openSofaRuleReview;
  installLauncher();

  const retry = setInterval(() => {
    if (document.getElementById('openSofaRuleReviewBtn')) {
      clearInterval(retry);
      return;
    }
    installLauncher();
  }, 600);
  setTimeout(() => clearInterval(retry), 12000);
}
