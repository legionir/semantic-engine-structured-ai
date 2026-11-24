"use strict";

/*
|--------------------------------------------------------------------------
| AWS event-stream decoder (roadmap P1-1)
|--------------------------------------------------------------------------
|
| Bedrock ConverseStream answers with application/vnd.amazon.eventstream:
| binary frames of
|
|   total length (4) | headers length (4) | prelude CRC32 (4)
|   headers | payload | message CRC32 (4)
|
| Both checksums are verified; a frame may span several chunks.
|--------------------------------------------------------------------------
*/

let crcTable = null;

function crc32(bytes) {

    if (!crcTable) {

        crcTable = new Uint32Array(256);

        for (let n = 0; n < 256; n++) {

            let c = n;

            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            }

            crcTable[n] = c >>> 0;
        }
    }

    let crc = 0xFFFFFFFF;

    for (let index = 0; index < bytes.length; index++) {
        crc = crcTable[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
}


function readHeaders(bytes) {

    const headers = {};

    let offset = 0;

    while (offset < bytes.length) {

        const nameLength = bytes.readUInt8(offset);

        offset += 1;

        const name = bytes.toString("utf8", offset, offset + nameLength);

        offset += nameLength;

        const type = bytes.readUInt8(offset);

        offset += 1;

        let value;

        switch (type) {

            case 0: value = true; break;
            case 1: value = false; break;
            case 2: value = bytes.readInt8(offset); offset += 1; break;
            case 3: value = bytes.readInt16BE(offset); offset += 2; break;
            case 4: value = bytes.readInt32BE(offset); offset += 4; break;
            case 5: value = Number(bytes.readBigInt64BE(offset)); offset += 8; break;
            case 8: value = Number(bytes.readBigInt64BE(offset)); offset += 8; break;
            case 9: value = bytes.toString("hex", offset, offset + 16); offset += 16; break;

            case 6:
            case 7: {

                const length = bytes.readUInt16BE(offset);

                offset += 2;

                value =
                    type === 7
                        ? bytes.toString("utf8", offset, offset + length)
                        : bytes.subarray(offset, offset + length);

                offset += length;

                break;
            }

            default:
                throw new Error(`event-stream header ${name} has unknown type ${type}`);
        }

        headers[name] = value;
    }

    return headers;
}


function parseFrame(frame) {

    const total = frame.readUInt32BE(0);
    const headersLength = frame.readUInt32BE(4);

    if (crc32(frame.subarray(0, 8)) !== frame.readUInt32BE(8)) {
        throw new Error("event-stream prelude checksum mismatch");
    }

    if (crc32(frame.subarray(0, total - 4)) !== frame.readUInt32BE(total - 4)) {
        throw new Error("event-stream message checksum mismatch");
    }

    return {
        headers: readHeaders(frame.subarray(12, 12 + headersLength)),
        payload: frame.subarray(12 + headersLength, total - 4)
    };
}


async function* decodeEventStream(chunks) {

    let buffer = Buffer.alloc(0);

    for await (const chunk of chunks) {

        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

        while (buffer.length >= 12) {

            const total = buffer.readUInt32BE(0);

            if (total < 16) {
                throw new Error("malformed event-stream frame");
            }

            if (buffer.length < total) {
                break;
            }

            const frame = buffer.subarray(0, total);

            buffer = buffer.subarray(total);

            yield parseFrame(frame);
        }
    }

    if (buffer.length > 0) {
        throw new Error("the event stream ended inside a frame");
    }
}


module.exports = {
    crc32,
    decodeEventStream
};
