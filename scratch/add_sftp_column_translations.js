import fs from 'fs';
import path from 'path';

const typeMapping = {
  'ar': 'النوع',
  'da': 'Type',
  'de': 'Typ',
  'en': 'Type',
  'es-MX': 'Tipo',
  'es': 'Tipo',
  'fi': 'Tyyppi',
  'fr': 'Type',
  'hi': 'प्रकार',
  'id': 'Tipe',
  'it': 'Tipo',
  'ja': 'タイプ',
  'ko': '유형',
  'ms': 'Jenis',
  'nl': 'Type',
  'no': 'Type',
  'pl': 'Typ',
  'pt-BR': 'Tipo',
  'pt-PT': 'Tipo',
  'ru': 'Тип',
  'sv': 'Typ',
  'th': 'ประเภท',
  'tr': 'Tür',
  'uk': 'Тип',
  'vi': 'Loại',
  'zh-CN': '类型',
  'zh-TW': '類型'
};

const ownerMapping = {
  'ar': 'المالك',
  'da': 'Ejer',
  'de': 'Besitzer',
  'en': 'Owner',
  'es-MX': 'Propietario',
  'es': 'Propietario',
  'fi': 'Omistaja',
  'fr': 'Propriétaire',
  'hi': 'मालिक',
  'id': 'Pemilik',
  'it': 'Proprietario',
  'ja': '所有者',
  'ko': '소유자',
  'ms': 'Pemilik',
  'nl': 'Eigenaar',
  'no': 'Eier',
  'pl': 'Właściciel',
  'pt-BR': 'Proprietário',
  'pt-PT': 'Proprietário',
  'ru': 'Владелец',
  'sv': 'Ägare',
  'th': 'เจ้าของ',
  'tr': 'Sahibi',
  'uk': 'Власник',
  'vi': 'Chủ sở hữu',
  'zh-CN': '所有者',
  'zh-TW': '所有者'
};

const localesDir = './src/i18n/locales';
const files = fs.readdirSync(localesDir);

files.forEach(file => {
  if (!file.endsWith('.ts')) return;
  const lang = file.replace('.ts', '');
  const typeVal = typeMapping[lang] || 'Type';
  const ownerVal = ownerMapping[lang] || 'Owner';
  
  const filePath = path.join(localesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/\r\n/g, '\n');
  
  if (content.includes('sftp_col_type:')) return;
  
  // We insert them right after sftp_col_name
  const target = "sftp_col_name: '";
  const idx = content.indexOf(target);
  if (idx !== -1) {
    const endLineIdx = content.indexOf('\n', idx);
    const line = content.substring(idx, endLineIdx);
    // Find the next comma or insert right after
    const targetKey = 'sftp_col_name:';
    const replacement = `sftp_col_type: '${typeVal}', sftp_col_owner: '${ownerVal}', sftp_col_name:`;
    content = content.replace(targetKey, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated column translations in ${file}`);
  } else {
    console.warn(`Could not find sftp_col_name in ${file}`);
  }
});
