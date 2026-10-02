import { getGuideProductTypeOverride, getGuideSeatingType } from '../../ui/guide-seating-type';
import { getGuideRoles } from './guide-roles';
import type { ObjectCategory, ObjectObservations } from '../decision-policy';
import { guideConstruction } from './construction-plan';
import { requiredGuideLabels } from './svg-guide-coverage';
export interface AvailableGuide {
  id: string;
  title: string;
  scope: string;
  version: string;
  category?: string;
  view?: string;
  svgPath?: string;
}
export interface GuideSource {
  localCatalogue(): Promise<AvailableGuide[]>;
  localSvg(path: string): Promise<string>;
  remoteKeys(): Promise<string[]>;
  remoteSvg(key: string): Promise<string | null>;
}
function guideCategory(code: string): string {
  return (
    getGuideProductTypeOverride(code) ||
    getGuideSeatingType(code) ||
    (code.startsWith('CC')
      ? 'cushion'
      : /^CS0(?:-|$)/.test(code)
        ? 'ottoman'
        : code.startsWith('CS5')
          ? 'chaise'
          : /^CS[1-4]/.test(code)
            ? 'sofa'
            : 'other')
  );
}
export class GuideService {
  constructor(private readonly source: GuideSource) {}
  async list(
    category: ObjectCategory,
    view?: string,
    search = '',
    observations?: ObjectObservations
  ) {
    const remote = (await this.source.remoteKeys()).flatMap(key => {
      const match = /^measurement-guides\/(front|back|side)_(.+)\.svg$/i.exec(key);
      if (!match) return [];
      const code = match[2].toUpperCase();
      return [
        {
          id: `remote:${key}`,
          title: code,
          category: guideCategory(code),
          view: match[1].toLowerCase(),
          scope: 'whole-furniture',
          version: 'current',
        },
      ];
    });
    const local = await this.source.localCatalogue();
    const candidates = [
      ...remote.filter(guide => guide.category === category && (!view || guide.view === view)),
      ...local.filter(guide => category !== 'cushion' || guide.scope === 'cushion'),
    ].filter(guide => !search || guide.title.toLowerCase().includes(search.toLowerCase()));
    const observedArm = observations?.armShape?.toLowerCase();
    const arm = observedArm?.includes('roll')
      ? 'rolled'
      : observedArm?.includes('slop')
        ? 'sloped'
        : observedArm?.includes('square')
          ? 'square'
          : observedArm?.includes('armless')
            ? 'armless'
            : undefined;
    return candidates
      .map(guide => {
        const construction = guideConstruction(guide.id);
        const differences: string[] = [];
        const matches: string[] = [];
        for (const [key, observed] of [
          ['armShape', arm],
          ['backHeight', observations?.backHeight],
        ] as const) {
          if (!observed || observed === 'unknown' || !construction[key]) continue;
          (observed === construction[key] ? matches : differences).push(key);
        }
        return { ...guide, construction, matches, differences };
      })
      .sort(
        (a, b) =>
          a.differences.length - b.differences.length ||
          b.matches.length - a.matches.length ||
          a.id.localeCompare(b.id)
      )
      .slice(0, 60);
  }
  async get(id: string) {
    if (id.startsWith('local:')) {
      const guide = (await this.source.localCatalogue()).find(item => item.id === id);
      if (!guide?.svgPath) throw new Error('Unknown local guide.');
      return { guide, svg: await this.source.localSvg(guide.svgPath) };
    }
    const key = id.slice('remote:'.length);
    if (
      !id.startsWith('remote:') ||
      !/^measurement-guides\/(front|back|side)_[A-Z0-9_-]+\.svg$/i.test(key)
    )
      throw new Error('Unknown guide.');
    const svg = await this.source.remoteSvg(key);
    if (!svg) throw new Error('Guide unavailable.');
    return {
      guide: { id, title: key, scope: 'whole-furniture', version: 'current' },
      svg,
      roles: getGuideRoles(id),
      requiredLabels: requiredGuideLabels(id, svg),
      construction: guideConstruction(id),
      supplementalRoles: /front_.*-(?:SA|SLA)-SB/i.test(id)
        ? [
            {
              label: 'B2',
              meaning:
                'Depth along the INNER upper arm boundary between rear arm/back join and front inner arm top corner.',
            },
            {
              label: 'E1',
              meaning:
                'Front inner-arm height between the inner upper arm boundary and front inner arm/seat boundary. Inspect the corrected short-back reference; never reuse a rolled-arm E1 contour.',
            },
            {
              label: 'E2',
              meaning:
                'Rear inner-arm height between the inner upper arm boundary and rear arm/seat/back junction; distinct from the front inner-arm height E1.',
            },
          ]
        : [],
      labelRules: {
        H3: 'Leg height only; omit when the leg is hidden. Never body/backrest height.',
        shortBackFront:
          'E1 and E2 are distinct inner-arm heights; retain B2. A legacy single E is insufficient.',
      },
    };
  }
}
