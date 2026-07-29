//----------------------------------------------------------------------------------------------------------------------
// Instance Theme Domain Model
//
// The instance's look as one JSON document: brand colors, chrome warmth, corner radius, color-mode policy, and a
// raw-CSS escape hatch. Null everywhere means "not set" -- the stock build-time look IS the default, and the
// theme only ever stores overrides. The document deliberately excludes identity (INSTANCE_NAME is a plain
// setting) and stays purely visual so a future installed theme package can replace it wholesale.
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
