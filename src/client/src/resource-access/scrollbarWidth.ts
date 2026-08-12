//----------------------------------------------------------------------------------------------------------------------
// Scrollbar Width
//
// How much layout space this platform's scrollbar takes, measured once off a probe element. Overlay scrollbars measure
// zero, which is exactly right -- they float over the content rather than narrowing it. A listing whose column header
// sits outside its scroller pads itself by this so the two stay in line.
//----------------------------------------------------------------------------------------------------------------------

let measured : number | null = null;

//----------------------------------------------------------------------------------------------------------------------

export function scrollbarWidth() : number
{
    if(measured !== null) { return measured; }

    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';

    document.body.append(probe);
    measured = probe.offsetWidth - probe.clientWidth;
    probe.remove();

    return measured;
}

//----------------------------------------------------------------------------------------------------------------------
