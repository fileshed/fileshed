//----------------------------------------------------------------------------------------------------------------------
// Scrollbar Width
//
// Overlay scrollbars measure zero, which is correct: they float over the content rather than narrowing it.
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
