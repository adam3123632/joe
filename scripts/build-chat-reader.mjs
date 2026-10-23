import {build} from 'esbuild';
import {readFile,writeFile,mkdir,rm,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'build/chat-reader-extension');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await build({
  entryPoints:[path.join(root,'chat-reader/content.ts')],
  outfile:path.join(output,'content.js'),
  bundle:true,format:'iife',platform:'browser',target:['chrome100'],
  minify:true,legalComments:'none',charset:'utf8',
});
const files=['manifest.json','popup.html','popup.css','popup.js'];
for(const file of files) await copyFile(path.join(root,'chat-reader',file),path.join(output,file));
await copyFile(path.join(root,'chat-reader/README.md'),path.join(output,'安装说明.txt'));

// A portable ZIP with stored entries, using only Node built-ins. File names are
// fixed build outputs; no user paths, shell commands, or external archiver.
function crc32(data) {
  let crc=0xffffffff;
  for(const byte of data) {
    crc^=byte;
    for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
const locals=[],directory=[];
let offset=0;
for(const file of [...files,'content.js','安装说明.txt']) {
  const name=Buffer.from(`tingjian-chat-reader/${file}`);
  const data=await readFile(path.join(output,file));
  const crc=crc32(data);
  const header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);
  header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);
  header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);
  central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
  central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
  locals.push(header,name,data);directory.push(central,name);offset+=header.length+name.length+data.length;
}
const central=Buffer.concat(directory);
const end=Buffer.alloc(22);
end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(directory.length/2,8);end.writeUInt16LE(directory.length/2,10);
end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
const archive=path.join(root,'build/tingjian-chat-reader.zip');
await writeFile(archive,Buffer.concat([...locals,central,end]));
console.log(`Built ${output}\nPackaged ${archive}`);
