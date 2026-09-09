(function exposeAttachmentQuality(root) {
  function hammingDistance(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    if (!a || a.length !== b.length) return Number.POSITIVE_INFINITY;
    let distance = 0;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) distance += 1;
    }
    return distance;
  }

  function pixelArea(attachment) {
    return Math.max(0, Number(attachment.width) || 0) * Math.max(0, Number(attachment.height) || 0);
  }

  function normalizedVariantUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ''));
      [
        'format',
        'width',
        'height',
        'w',
        'h',
        'size',
        'sz',
        'quality',
        'resize',
        'crop',
        'fit',
        'dpr',
      ].forEach(key => url.searchParams.delete(key));
      url.hash = '';
      return url.href;
    } catch {
      return '';
    }
  }

  function sourceQuality(attachment) {
    const url = String(attachment.url || '');
    let score = Number(attachment.quality) || 0;
    if (/\/api\/attachment\/download\/|original|source/i.test(url)) score += 100;
    if (
      /[?&](?:format|width|height|w|h|size|sz|resize)=|thumbnail|thumb|preview|small/i.test(url)
    ) {
      score -= 200;
    }
    return score;
  }

  function areVisualVariants(left, right) {
    if (left.contentHash && left.contentHash === right.contentHash) return true;
    const leftUrl = normalizedVariantUrl(left.url);
    const rightUrl = normalizedVariantUrl(right.url);
    if (leftUrl && leftUrl === rightUrl) return true;
    if (!left.visualHash || !right.visualHash) return false;
    const leftRatio = Number(left.width) / Math.max(1, Number(left.height));
    const rightRatio = Number(right.width) / Math.max(1, Number(right.height));
    if (!Number.isFinite(leftRatio) || !Number.isFinite(rightRatio)) return false;
    if (Math.abs(leftRatio - rightRatio) / Math.max(leftRatio, rightRatio) > 0.015) return false;
    return hammingDistance(left.visualHash, right.visualHash) <= 3;
  }

  function qualityRank(attachment) {
    return [
      sourceQuality(attachment),
      pixelArea(attachment),
      Math.max(0, Number(attachment.byteSize) || 0),
    ];
  }

  function isHigherQuality(candidate, current) {
    const candidateRank = qualityRank(candidate);
    const currentRank = qualityRank(current);
    for (let index = 0; index < candidateRank.length; index += 1) {
      if (candidateRank[index] !== currentRank[index])
        return candidateRank[index] > currentRank[index];
    }
    return false;
  }

  function classifyAttachmentVariants(attachments) {
    const output = attachments.map(attachment => ({
      ...attachment,
      excludedAsLowQuality: false,
      preferredVariantIndex: null,
    }));
    const groups = [];

    output.forEach((attachment, index) => {
      const group = groups.find(candidate =>
        candidate.some(candidateIndex => areVisualVariants(attachment, output[candidateIndex]))
      );
      if (group) group.push(index);
      else groups.push([index]);
    });

    groups
      .filter(group => group.length > 1)
      .forEach(group => {
        let preferredIndex = group[0];
        group.slice(1).forEach(index => {
          if (isHigherQuality(output[index], output[preferredIndex])) preferredIndex = index;
        });
        group.forEach(index => {
          if (index === preferredIndex) return;
          output[index].excludedAsLowQuality = true;
          output[index].preferredVariantIndex = preferredIndex;
        });
      });

    return output;
  }

  function formatResolution(attachment) {
    const width = Math.round(Number(attachment.width) || 0);
    const height = Math.round(Number(attachment.height) || 0);
    return width && height ? `${width} × ${height}` : 'Resolution unavailable';
  }

  root.GorgiasAttachmentQuality = {
    areVisualVariants,
    classifyAttachmentVariants,
    formatResolution,
    hammingDistance,
  };
})(globalThis);
