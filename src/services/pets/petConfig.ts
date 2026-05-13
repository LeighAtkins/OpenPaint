// Pet configuration — maps petId to sprite sheet paths + animation metadata

export interface PetAnimationConfig {
  path: string;
  frameCount: number;
}

export interface PetBehaviorProfile {
  followLerp: number;
  roamLerp: number;
  cursorSleepDelayMs: number;
  roamPauseMinMs: number;
  roamPauseMaxMs: number;
  roamSleepMinMs: number;
  roamSleepMaxMs: number;
  roamSleepGapMinMs: number;
  roamSleepGapMaxMs: number;
  sleepOnVectorChance: number;
  sleepAtFrameCenterChance: number;
  zoomiesChance: number;
  zoomiesDurationMs: number;
  zoomiesCooldownMinMs: number;
  zoomiesCooldownMaxMs: number;
  inspectVectorChance: number;
  inspectPauseMinMs: number;
  inspectPauseMaxMs: number;
  inspectCooldownMinMs: number;
  inspectCooldownMaxMs: number;
  wakeStretchMs: number;
}

export interface PetConfig {
  type: 'cat' | 'dog';
  frameSize: number; // pixels per frame (width = height)
  displaySize: number; // rendered size on screen
  animations: {
    idle: PetAnimationConfig;
    walk: PetAnimationConfig;
    run: PetAnimationConfig;
  };
  sleepFrames?: PetAnimationConfig[];
  behavior: PetBehaviorProfile;
}

const DOG_BREEDS: Record<string, string> = {
  'dog-1': 'Golden-Retriever',
  'dog-2': 'Akita',
  'dog-3': 'Great-Dane',
  'dog-4': 'Schnauzer',
  'dog-5': 'Saint-Bernard',
  'dog-6': 'Siberian-Husky',
};

// Dog idle files have inconsistent casing — map explicitly
const DOG_IDLE_FILENAMES: Record<string, string> = {
  'dog-1': 'Golden-Retriever-idle.png',
  'dog-2': 'Akita-Idle.png',
  'dog-3': 'Great-Dane-idle.png',
  'dog-4': 'Schnauzer-Idle.png',
  'dog-5': 'Saint-Bernard-Idle.png',
  'dog-6': 'Siberian-Husky-Idle.png',
};

const CAT_BASE_BEHAVIOR: PetBehaviorProfile = {
  followLerp: 0.072,
  roamLerp: 0.042,
  cursorSleepDelayMs: 2200,
  roamPauseMinMs: 650,
  roamPauseMaxMs: 1800,
  roamSleepMinMs: 2600,
  roamSleepMaxMs: 4200,
  roamSleepGapMinMs: 5200,
  roamSleepGapMaxMs: 9000,
  sleepOnVectorChance: 0.65,
  sleepAtFrameCenterChance: 0.25,
  zoomiesChance: 0.18,
  zoomiesDurationMs: 1800,
  zoomiesCooldownMinMs: 12000,
  zoomiesCooldownMaxMs: 22000,
  inspectVectorChance: 0.5,
  inspectPauseMinMs: 1100,
  inspectPauseMaxMs: 2200,
  inspectCooldownMinMs: 7000,
  inspectCooldownMaxMs: 14000,
  wakeStretchMs: 680,
};

const DOG_BASE_BEHAVIOR: PetBehaviorProfile = {
  followLerp: 0.095,
  roamLerp: 0.032,
  cursorSleepDelayMs: 3200,
  roamPauseMinMs: 900,
  roamPauseMaxMs: 2400,
  roamSleepMinMs: 3000,
  roamSleepMaxMs: 5200,
  roamSleepGapMinMs: 7000,
  roamSleepGapMaxMs: 12000,
  sleepOnVectorChance: 0.45,
  sleepAtFrameCenterChance: 0.4,
  zoomiesChance: 0.1,
  zoomiesDurationMs: 1600,
  zoomiesCooldownMinMs: 14000,
  zoomiesCooldownMaxMs: 26000,
  inspectVectorChance: 0.32,
  inspectPauseMinMs: 1000,
  inspectPauseMaxMs: 1900,
  inspectCooldownMinMs: 8500,
  inspectCooldownMaxMs: 17000,
  wakeStretchMs: 540,
};

const PET_BEHAVIOR_OVERRIDES: Record<string, Partial<PetBehaviorProfile>> = {
  'cat-1': { zoomiesChance: 0.08, cursorSleepDelayMs: 1700, sleepAtFrameCenterChance: 0.4 },
  'cat-2': { inspectVectorChance: 0.62, sleepOnVectorChance: 0.75 },
  'cat-3': { inspectVectorChance: 0.72, zoomiesChance: 0.16 },
  'cat-4': { roamLerp: 0.037, wakeStretchMs: 760 },
  'cat-5': { zoomiesChance: 0.2, sleepAtFrameCenterChance: 0.34 },
  'cat-6': { followLerp: 0.085, zoomiesChance: 0.28, zoomiesDurationMs: 2100 },
  'dog-1': { followLerp: 0.11, roamLerp: 0.028, zoomiesChance: 0.06 },
  'dog-2': { inspectVectorChance: 0.42, sleepOnVectorChance: 0.54 },
  'dog-3': { roamLerp: 0.026, sleepAtFrameCenterChance: 0.58, zoomiesChance: 0.04 },
  'dog-4': { inspectVectorChance: 0.38, wakeStretchMs: 620 },
  'dog-5': { cursorSleepDelayMs: 2700, sleepAtFrameCenterChance: 0.65 },
  'dog-6': { zoomiesChance: 0.3, zoomiesDurationMs: 2300, followLerp: 0.105 },
};

function resolveBehavior(petId: string, type: 'cat' | 'dog'): PetBehaviorProfile {
  const base = type === 'cat' ? CAT_BASE_BEHAVIOR : DOG_BASE_BEHAVIOR;
  const override = PET_BEHAVIOR_OVERRIDES[petId] || {};
  return { ...base, ...override };
}

export function buildPetConfig(petId: string): PetConfig | null {
  const match = /^(cat|dog)-(\d)$/.exec(petId);
  if (!match) return null;

  const [, type, num] = match;

  if (type === 'cat') {
    const dir = `/assets/pets/cats/Cat-${num}`;
    return {
      type: 'cat',
      frameSize: 50,
      displaySize: 96,
      animations: {
        idle: { path: `${dir}/Cat-${num}-Idle.png`, frameCount: 10 },
        walk: { path: `${dir}/Cat-${num}-Walk.png`, frameCount: 8 },
        run: { path: `${dir}/Cat-${num}-Run.png`, frameCount: 8 },
      },
      sleepFrames: [
        { path: `${dir}/Cat-${num}-Sleeping1.png`, frameCount: 1 },
        { path: `${dir}/Cat-${num}-Sleeping2.png`, frameCount: 1 },
      ],
      behavior: resolveBehavior(petId, 'cat'),
    };
  }

  const breed = DOG_BREEDS[petId];
  if (!breed) return null;

  const dirName = `Dog-${num}-${breed}`;
  const dir = `/assets/pets/dogs/${dirName}`;
  const idleFile = DOG_IDLE_FILENAMES[petId];

  return {
    type: 'dog',
    frameSize: 100,
    displaySize: 192,
    animations: {
      idle: { path: `${dir}/${idleFile}`, frameCount: 10 },
      walk: { path: `${dir}/${breed}-walk.png`, frameCount: 8 },
      run: { path: `${dir}/${breed}-run.png`, frameCount: 8 },
    },
    sleepFrames: [{ path: `${dir}/${breed}-sleeping.png`, frameCount: 1 }],
    behavior: resolveBehavior(petId, 'dog'),
  };
}
