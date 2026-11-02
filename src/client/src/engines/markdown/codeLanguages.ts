//----------------------------------------------------------------------------------------------------------------------
// Code Languages
//
// A fence names its language by the first word of its info string, matched exactly against a language's name or
// aliases. CodeMirror's own fuzzy match would read `text` as LaTeX, since it contains the alias `tex`.
//----------------------------------------------------------------------------------------------------------------------

import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

//----------------------------------------------------------------------------------------------------------------------

export interface CodeLanguageOption
{
    label : string;
    value : string;
}

const FIRST_WORD = /^\S*/u;
const ONE_WORD = /^\S+$/u;

function firstWord(info : string | null) : string
{
    return FIRST_WORD.exec(info ?? '')?.[0] ?? '';
}

// The word a language is written as in a fence: its name when that is one word (`python`, `c++`), else its first
// one-word alias (`Properties files` is `ini`). A language with neither can't be named by a fence.
function fenceWord(description : LanguageDescription) : string | undefined
{
    return [ description.name.toLowerCase(), ...description.alias ].find((name) => ONE_WORD.test(name));
}

//----------------------------------------------------------------------------------------------------------------------

export function findCodeLanguage(info : string | null) : LanguageDescription | null
{
    const word = firstWord(info);
    return word === '' ? null : LanguageDescription.matchLanguageName(languages, word, false);
}

export const codeLanguageOptions : CodeLanguageOption[] = languages
    .flatMap((description) =>
    {
        const word = fenceWord(description);
        return word === undefined ? [] : [ { label: description.name, value: word } ];
    })
    .sort((left, right) => left.label.localeCompare(right.label));

// The option a fence's language selects: the word the picker writes for it, so `js` and `javascript` both select
// JavaScript. A language the picker doesn't know keeps the fence's own word, and no language is ''.
export function fenceLanguageWord(info : string | null) : string
{
    const description = findCodeLanguage(info);
    return (description && fenceWord(description)) ?? firstWord(info);
}

// The info string with its language replaced and anything after the language kept. An empty word clears the info
// string entirely, since what follows the language would otherwise be read as one.
export function withFenceLanguage(info : string | null, word : string) : string | null
{
    return word === '' ? null : (info ?? '').replace(FIRST_WORD, word);
}

//----------------------------------------------------------------------------------------------------------------------
