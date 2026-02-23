// Pet configuration — maps petId to sprite sheet paths + animation metadata

export interface PetAnimationConfig {
  path: string;
  frameCount: number;
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

export function buildPetConfig(petId: string): PetConfig | null {
  const match = /^(cat|dog)-(\d)$/.exec(petId);
  if (!match) return null;

  const [, type, num] = match;

  if (type === 'cat') {
    const dir = `/assets/pets/cats/Cat-${num}`;
    return {
      type: 'cat',
      frameSize: 50,
      displaySize: 48,
      animations: {
        idle: { path: `${dir}/Cat-${num}-Idle.png`, frameCount: 10 },
        walk: { path: `${dir}/Cat-${num}-Walk.png`, frameCount: 8 },
        run: { path: `${dir}/Cat-${num}-Run.png`, frameCount: 8 },
      },
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
    displaySize: 48,
    animations: {
      idle: { path: `${dir}/${idleFile}`, frameCount: 10 },
      walk: { path: `${dir}/${breed}-walk.png`, frameCount: 8 },
      run: { path: `${dir}/${breed}-run.png`, frameCount: 8 },
    },
  };
}
