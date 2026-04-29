const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const src = path.join(__dirname, '..', 'src', 'assets', 'titlebar-logo.png');
const out = path.join(__dirname, 'icon.ico');

pngToIco([src])
  .then((buf) => {
    fs.writeFileSync(out, buf);
    console.log('icon.ico built:', out, buf.length, 'bytes');
  })
  .catch((e) => {
    console.error('make-ico failed:', e && e.message);
    process.exit(1);
  });
