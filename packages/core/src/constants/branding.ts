//----------------------------------------------------------------------------------------------------------------------
// Branding Constants
//----------------------------------------------------------------------------------------------------------------------

// The radius slider's range in rem; Nuxt UI's stock --ui-radius is 0.25rem, and past 1rem every control reads as
// a pill.
export const THEME_RADIUS_MAX = 1;

// The build-time look, in one place: vite.config.ts wires these families into Nuxt UI, and the Branding tab
// reads the same object to show what "default" means -- so the two can never drift.
export const STOCK_THEME = {
    primary: 'shed',
    secondary: 'violet',
    neutral: 'zinc',
    radius: 0.25,
} as const;

// Custom CSS is an escape hatch, not a stylesheet host -- the cap only exists to keep a paste-accident out of
// the settings table.
export const CUSTOM_CSS_MAX_LENGTH = 65_536;

// The instance name lands in page titles, the sidebar wordmark, and email From lines; past a hundred characters it
// stops being a name and starts breaking layouts.
export const INSTANCE_NAME_MAX_LENGTH = 100;

// Wider than the avatar whitelist on purpose: SVG is the natural logo format and the favicon path wants ICO,
// and unlike avatars (user-generated, served to everyone) the logo is uploaded by the admin -- who already
// holds the custom-CSS pen, so SVG's script surface adds nothing new.
export const brandingImageMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon',
] as const;
export type BrandingImageMimeType = typeof brandingImageMimeTypes[number];

//----------------------------------------------------------------------------------------------------------------------
