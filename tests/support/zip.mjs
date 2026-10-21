/**
 * Minimal stored (uncompressed) ZIP writer for fixtures. Word documents are
 * ZIP archives, so the preview test needs a real package without adding a build
 * dependency. This supports small test files only.
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** `files` is a map of archive path to string or Uint8Array content. */
export function zipStore(files) {
  const encoder = new TextEncoder();
  const entries = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data =
      typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    entries.push({ nameBytes, data, crc, offset, local });
    offset += local.length + nameBytes.length + data.length;
  }

  const directorySize = entries.reduce(
    (size, entry) => size + 46 + entry.nameBytes.length,
    0,
  );
  const output = Buffer.alloc(offset + directorySize + 22);
  let cursor = 0;
  for (const entry of entries) {
    entry.local.copy(output, cursor);
    cursor += entry.local.length;
    Buffer.from(entry.nameBytes).copy(output, cursor);
    cursor += entry.nameBytes.length;
    Buffer.from(entry.data).copy(output, cursor);
    cursor += entry.data.length;
  }
  const directoryStart = cursor;
  for (const entry of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(entry.nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    header.copy(output, cursor);
    cursor += header.length;
    Buffer.from(entry.nameBytes).copy(output, cursor);
    cursor += entry.nameBytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cursor - directoryStart, 12);
  end.writeUInt32LE(directoryStart, 16);
  end.writeUInt16LE(0, 20);
  end.copy(output, cursor);
  return new Uint8Array(output);
}
