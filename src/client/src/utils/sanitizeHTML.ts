//----------------------------------------------------------------------------------------------------------------------
// Sanitize HTML
//----------------------------------------------------------------------------------------------------------------------

import DOMPurify from 'dompurify';

//----------------------------------------------------------------------------------------------------------------------

export interface SanitizedHTML
{
    html : string;

    // Whether it draws anything: text, or an element that shows without any (an image, a rule, a line break).
    visible : boolean;
}

// Elements a file's HTML may not bring into the app's page: nothing scopes a <style> element, so it restyles the whole
// app, and a form collects what the reader types and can send it anywhere.
const FORBIDDEN_TAGS = [ 'style', 'form', 'input', 'button', 'select', 'textarea' ];

const SHOWS_WITHOUT_TEXT = 'img, svg, video, audio, picture, hr, br';

const purifier = DOMPurify(window);

// A link opens in a new tab: followed in place, it would navigate the app away from the open file.
purifier.addHook('afterSanitizeAttributes', (node) =>
{
    if(node instanceof HTMLAnchorElement && node.hasAttribute('href'))
    {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

//----------------------------------------------------------------------------------------------------------------------

export function sanitizeHTML(source : string) : SanitizedHTML
{
    const fragment = purifier.sanitize(source, { FORBID_TAGS: FORBIDDEN_TAGS, RETURN_DOM_FRAGMENT: true });
    const holder = document.createElement('div');
    holder.append(fragment);

    return {
        html: holder.innerHTML,
        visible: (holder.textContent ?? '').trim() !== '' || holder.querySelector(SHOWS_WITHOUT_TEXT) !== null,
    };
}

//----------------------------------------------------------------------------------------------------------------------
