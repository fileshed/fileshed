//----------------------------------------------------------------------------------------------------------------------
// Copy To Clipboard
//
// navigator.clipboard only exists in secure contexts -- a self-hosted box reached over plain HTTP on a LAN IP has no
// clipboard API at all, and a bare writeText call throws before any catch sees a rejection. The deprecated
// execCommand path is the only copy that works there, so it is the fallback, not an error. Returns whether the text
// actually landed on the clipboard, so callers can tell the user to copy by hand instead of pretending.
//----------------------------------------------------------------------------------------------------------------------

export async function copyToClipboard(text : string) : Promise<boolean>
{
    if(navigator.clipboard !== undefined)
    {
        try
        {
            await navigator.clipboard.writeText(text);
            return true;
        }
        catch { /* permission refused: fall through to the legacy path */ }
    }

    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();

    try
    {
        return document.execCommand('copy');
    }
    catch
    {
        return false;
    }
    finally
    {
        scratch.remove();
    }
}

//----------------------------------------------------------------------------------------------------------------------
