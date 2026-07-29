//----------------------------------------------------------------------------------------------------------------------
// Byte Size Parsing
//
// Human-entered sizes for the byte-cap inputs: "20gb", "20 GB", "200kb", "1.5tb", or plain bytes ("2048"). Units
// are decimal (1 KB = 1000 B), matching formatBytes and the storage figures cloud drives present. The result is
// always a whole, safe byte count -- fractional magnitudes are fine with a unit ("1.5gb"), rejected when they
// yield fractional bytes -- and anything unparseable is null, never a guess.
//----------------------------------------------------------------------------------------------------------------------

const BYTE_SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|pb)?$/;

function unitFactor(unit : string | undefined) : number
{
    switch (unit)
    {
        case 'kb': return 1e3;
        case 'mb': return 1e6;
        case 'gb': return 1e9;
        case 'tb': return 1e12;
        case 'pb': return 1e15;
        default: return 1;
    }
}

//----------------------------------------------------------------------------------------------------------------------

export function parseByteSize(input : string) : number | null
{
    const match = BYTE_SIZE_PATTERN.exec(input.trim().toLowerCase());
    if(!match) { return null; }

    const [ , magnitude, unit ] = match;
    const bytes = Number(magnitude) * unitFactor(unit);

    return Number.isSafeInteger(bytes) ? bytes : null;
}

// The confirmation line under a size input: the parsed count in whole bytes.
export function describeByteSize(bytes : number) : string
{
    return `${ bytes.toLocaleString() } bytes`;
}

//----------------------------------------------------------------------------------------------------------------------
