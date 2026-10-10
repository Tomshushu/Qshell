import fs from 'fs';
import path from 'path';

const logos = {
  centos: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/centos/centos-original.svg',
  debian: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/debian/debian-original.svg',
  almalinux: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/almalinux/almalinux-original.svg',
  fedora: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/fedora/fedora-original.svg',
  alpine: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/alpine/alpine-original.svg',
  archlinux: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/archlinux/archlinux-original.svg',
  opensuse: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/opensuse/opensuse-original.svg',
  ubuntu: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/ubuntu/ubuntu-original.svg',
  redhat: 'https://fastly.jsdelivr.net/gh/devicons/devicon@latest/icons/redhat/redhat-original.svg'
};

const outputDir = './scratch/logos';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function download() {
  for (const [name, url] of Object.entries(logos)) {
    console.log(`Downloading ${name} from ${url}...`);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const text = await response.ok ? await response.text() : '';
      fs.writeFileSync(path.join(outputDir, `${name}.svg`), text);
      console.log(`Successfully saved ${name}.svg`);
    } catch (err) {
      console.error(`Failed to download ${name}:`, err.message);
    }
  }
}

download();
