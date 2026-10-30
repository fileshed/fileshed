//----------------------------------------------------------------------------------------------------------------------
// Instance Theme Domain Model
//
// Null everywhere means "not set": the stock build-time look is the default, and the theme only ever stores overrides.
// Identity stays out of it (INSTANCE_NAME is a plain setting), so the document is purely visual and replacing it
// wholesale never touches the instance's name.
//----------------------------------------------------------------------------------------------------------------------

export const colorModes = [ 'system', 'light', 'dark' ] as const;
export type ColorMode = typeof colorModes[number];

export const neutralFamilies = [ 'slate', 'gray', 'zinc', 'neutral', 'stone' ] as const;
export type NeutralFamily = typeof neutralFamilies[number];

export interface InstanceTheme
{
    primary : string | null;
    secondary : string | null;
    neutral : NeutralFamily | null;
    radius : number | null;

    // The default mode for visitors who have not chosen; forcedMode makes it mandatory and hides the choice.
    mode : ColorMode;
    forcedMode : boolean;

    customCSS : string | null;
}

export const defaultInstanceTheme : Readonly<InstanceTheme> = {
    primary: null,
    secondary: null,
    neutral: null,
    radius: null,
    mode: 'system',
    forcedMode: false,
    customCSS: null,
};

//----------------------------------------------------------------------------------------------------------------------
