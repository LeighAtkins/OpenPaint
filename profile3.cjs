const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  for (const f of ['CS3B-SRA-SB-L-front','CS3B-SRA-HB-R-front','CS3B-SRA-SB-L-side','CS3B-SRA-HB-R-side']) {
    let svg = fs.readFileSync(`/tmp/gallery-eval/${f}.svg`, 'utf-8')
      .replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/, '');
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    const res = await page.evaluate(() => {
      const svgEl = document.querySelector('svg');
      const s = new XMLSerializer().serializeToString(svgEl);
      const img = new Image();
      const blob = new Blob([s], {type:'image/svg+xml'});
      const url = URL.createObjectURL(blob);
      return new Promise(resolve => {
        img.onload = () => {
          const W = 700, H = Math.round(700 * (img.height/img.width) || 460);
          const c = document.createElement('canvas');
          c.width=W; c.height=H;
          const ctx = c.getContext('2d');
          ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H);
          ctx.drawImage(img,0,0,W,H);
          const data = ctx.getImageData(0,0,W,H).data;
          const isOutline=(x,y)=>{const i=(y*W+x)*4;const r=data[i],g=data[i+1],b=data[i+2];
            return Math.abs(r-79)<45&&Math.abs(g-79)<45&&Math.abs(b-79)<45;};
          const topByCol=new Array(W).fill(-1);
          for(let x=0;x<W;x++)for(let y=0;y<H;y++){if(isOutline(x,y)){topByCol[x]=y;break;}}
          let minX=W,maxX=0,minY=H,maxY=0;
          for(let x=0;x<W;x++){if(topByCol[x]>=0){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,topByCol[x]);
            for(let y=H-1;y>=0;y--){if(isOutline(x,y)){maxY=Math.max(maxY,y);break;}}}}
          URL.revokeObjectURL(url);
          return {W,H,minX,maxX,minY,maxY,topByCol};
        };
        img.src=url;
      });
    });
    const outW=res.maxX-res.minX, outH=res.maxY-res.minY;
    const band=(a,b)=>{let t=Infinity;const x0=res.minX+outW*a,x1=res.minX+outW*b;
      for(let x=Math.floor(x0);x<x1;x++){if(res.topByCol[x]>=0)t=Math.min(t,res.topByCol[x]);}
      return t===Infinity?-1:t;};
    console.log(`\n=== ${f} ===  outline ${outW}x${outH}px`);
    const bands = f.includes('front')
      ? [['left arm',0.00,0.10],['back-left',0.15,0.35],['back-centre',0.35,0.65],['back-right',0.65,0.85],['right arm',0.90,1.00]]
      : [['front edge',0.00,0.15],['seat mid',0.30,0.55],['back region',0.80,0.95]];
    bands.forEach(([n,a,b])=>{
      const px=band(a,b);
      const rel=px<0?'none':((px-res.minY)/outH).toFixed(3);
      console.log(`  ${n.padEnd(13)} top=${px>=0?px:'none'}  rel_height=${rel}`);
    });
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
