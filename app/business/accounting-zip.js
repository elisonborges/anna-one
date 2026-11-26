// ZIP não comprimido (ZIP32), sem dependência externa; entradas UTF-8.
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function createAccountingZip(entries){
 if(!Array.isArray(entries)||entries.length<1||entries.length>1000)throw Error('Quantidade de arquivos inválida.');
 let offset=0,centralSize=0,total=0;const locals=[],central=[],names=new Set();
 for(const {name,bytes} of entries){
  if(typeof name!=='string'||!name||/[\\/\u0000-\u001f\u007f]/.test(name)||name==='.'||name==='..'||names.has(name)||!(bytes instanceof Uint8Array))throw Error('Entrada ZIP inválida.');
  names.add(name);total+=bytes.length;if(total>18*1024*1024)throw Error('Pacote excede o limite de 18 MiB.');
  const n=encoder.encode(name);if(n.length>65535)throw Error('Nome excede o limite.');
  const crc=crc32(bytes),h=new Uint8Array(30+n.length),v=new DataView(h.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,n.length,true);h.set(n,30);
  const c=new Uint8Array(46+n.length),d=new DataView(c.buffer);
  d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);c.set(n,46);
  locals.push(h,bytes);central.push(c);offset+=h.length+bytes.length;centralSize+=c.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);
 e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
 return new Blob([...locals,...central,end],{type:'application/zip'});
}
