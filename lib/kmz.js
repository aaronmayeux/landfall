/**
 * kmz.js — a KMZ is a zip. This gets the KML out of it, and nothing else.
 *
 * ==> THIS IS TRANSPORT, NOT INTERPRETATION. <== §4's rule is that a route
 * forwards and caches and does not interpret its payload. Unwrapping a
 * container is the same category as gunzipping a response or decoding base64:
 * it changes the packaging and not one byte of meaning. `gtwo-kml.js` next
 * door does the interpreting. Keeping the two apart is what makes this file
 * boring enough to trust.
 *
 * ==> WHY NOT A ZIP LIBRARY. <== There is no build step (§12), so every
 * dependency is a vendored file somebody has to maintain forever. A zip whose
 * entries are all deflate is about forty lines of header arithmetic plus
 * `DecompressionStream`, which is native in browsers, in workerd and in node
 * 18+. Forty lines we own beats ten kilobytes we don't.
 *
 * ==> IT REFUSES RATHER THAN GUESSES. <== Every unexpected shape throws with a
 * sentence a person can read, because the caller's job under §5 is to say what
 * went wrong and this is where the detail lives. A zip we half-understand
 * would produce half a KML, and half a KML parses into a confident wrong
 * answer.
 *
 * MEASURED, NHC's gtwo KMZs on 2026-08-19: five entries, every one method 8
 * (deflate), general-purpose flag 0, sizes present in the local header. The
 * KML is the first entry. None of that is assumed below — the walk reads what
 * is there — but it is why the walk is this short.
 *
 * Imports nothing. Never DOM, never fetch.
 */

/** The four-byte signature opening every local file header in a zip. */
const LOCAL_HEADER = 0x04034b50;
/** Fixed part of a local file header, before the name and the extra field. */
const LOCAL_HEADER_BYTES = 30;

/** Stored, i.e. not compressed at all. Legal, and NHC has never used it. */
const METHOD_STORE = 0;
/** Deflate. What NHC actually publishes. */
const METHOD_DEFLATE = 8;

/**
 * ==> BIT 3 IS THE ONE THAT WOULD SILENTLY BREAK THIS. <== When the
 * general-purpose flag has bit 3 set, the compressed size in the local header
 * is a placeholder zero and the real value trails the data in a descriptor
 * the walk cannot find without the central directory. Reading it anyway
 * yields an entry of length zero and a walk that lands in the middle of a
 * PNG. So it is detected and refused by name.
 */
const FLAG_DATA_DESCRIPTOR = 0x08;

/** Anything longer than this is not a Tropical Weather Outlook and reading it
 *  into a string would be the first half of a memory problem on a phone. The
 *  largest ever measured is 32 KB. */
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;

/** Bytes → a Uint8Array view, whatever shape they arrived in. */
function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('kmz: expected bytes (Uint8Array, ArrayBuffer or a view)');
}

/**
 * One pass over the local file headers, listing what is in the archive.
 *
 * The central directory at the end of the file is the canonical index and
 * this deliberately does not read it. Walking forward needs no seeking, works
 * on a stream that arrived in one piece, and — the actual reason — fails
 * LOUDLY on the one case it cannot handle rather than quietly on several.
 */
function* entries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;

  while (at + LOCAL_HEADER_BYTES <= bytes.byteLength) {
    if (view.getUint32(at, true) !== LOCAL_HEADER) return;

    const flag = view.getUint16(at + 6, true);
    const method = view.getUint16(at + 8, true);
    const compressed = view.getUint32(at + 18, true);
    const uncompressed = view.getUint32(at + 22, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);

    if (flag & FLAG_DATA_DESCRIPTOR) {
      throw new Error(
        'kmz: this zip stores its sizes after the data, which this reader '
        + 'cannot follow. NHC has never published one this way.'
      );
    }

    const nameAt = at + LOCAL_HEADER_BYTES;
    const dataAt = nameAt + nameLength + extraLength;
    if (dataAt + compressed > bytes.byteLength) {
      throw new Error('kmz: the archive is truncated — an entry runs past the end of the file.');
    }

    yield {
      name: new TextDecoder().decode(bytes.subarray(nameAt, nameAt + nameLength)),
      method,
      uncompressed,
      data: bytes.subarray(dataAt, dataAt + compressed),
    };

    at = dataAt + compressed;
  }
}

/** Raw deflate → bytes, through the platform's own decompressor. */
async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A KMZ's bytes → the text of the KML inside it.
 *
 * The first entry whose name ends `.kml` wins. NHC puts it first and names it
 * for the basin (`gtwo_atl.kml`, `gtwo_pac.kml`), but neither of those is
 * required here — matching on the extension means a renamed file still works
 * and a reordered archive still works, while a KMZ containing no KML at all
 * still fails, which is the case worth catching.
 *
 * Throws, never returns null. A caller that cannot tell "no KML in here" from
 * "here is the KML" writes the §5 bug this project keeps having.
 */
export async function kmlFromKmz(input) {
  const bytes = asBytes(input);
  if (bytes.byteLength === 0) throw new Error('kmz: no bytes.');

  for (const entry of entries(bytes)) {
    if (!/\.kml$/i.test(entry.name)) continue;

    if (entry.uncompressed > MAX_ENTRY_BYTES) {
      throw new Error(`kmz: ${entry.name} is ${entry.uncompressed} bytes, which is not an outlook.`);
    }
    if (entry.method === METHOD_STORE) {
      return new TextDecoder().decode(entry.data);
    }
    if (entry.method === METHOD_DEFLATE) {
      return new TextDecoder().decode(await inflate(entry.data));
    }
    throw new Error(
      `kmz: ${entry.name} uses compression method ${entry.method}, which this reader does not speak.`
    );
  }

  throw new Error('kmz: the archive contains no .kml entry.');
}

/** Every entry name in the archive, for diagnostics and for the tests that
 *  assert we are looking at the file we think we are. Cheap — it decompresses
 *  nothing. */
export function kmzEntryNames(input) {
  return [...entries(asBytes(input))].map((e) => e.name);
}
