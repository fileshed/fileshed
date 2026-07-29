//----------------------------------------------------------------------------------------------------------------------
// Provider Presentation
//
// Display facts for the social providers. Labels and icons derive mechanically -- capitalize the id, follow the
// simple-icons naming -- with override maps only where the rule gets it wrong. Console URLs cannot derive and are
// curated outright. Every miss fails soft: an unknown icon renders as empty space and a provider without a console
// entry renders no link, so a gap in this file never blocks a working provider.
//----------------------------------------------------------------------------------------------------------------------

import type { SocialProviderID } from '@fileshed/core';

//----------------------------------------------------------------------------------------------------------------------

const LABEL_OVERRIDES : Partial<Record<SocialProviderID, string>> = {
    github: 'GitHub',
    gitlab: 'GitLab',
    linkedin: 'LinkedIn',
    paypal: 'PayPal',
    tiktok: 'TikTok',
    huggingface: 'Hugging Face',
    vk: 'VK',
    wechat: 'WeChat',
};

const ICON_OVERRIDES : Partial<Record<SocialProviderID, string>> = {
    // simple-icons dropped some corporate marks; X replaced the twitter bird.
    twitter: 'i-simple-icons-x',
    microsoft: 'i-lucide-square-user',
    cognito: 'i-simple-icons-amazonwebservices',
    // No brand glyph in simple-icons at all -- a neutral key beats an empty box.
    paybin: 'i-lucide-key-round',
    polar: 'i-lucide-key-round',
};

// Where each provider hands out OAuth credentials. Hand-curated -- there is no pattern to derive -- and
// deliberately partial: a provider without an entry renders no link, which beats guessing at a console that moved.
// Absent on purpose: Salesforce (the console lives on your org's own domain), Polar (org-scoped dashboard),
// Railway and Paybin (no public app console to point at).
const CONSOLE_URLS : Partial<Record<SocialProviderID, string>> = {
    apple: 'https://developer.apple.com/account/resources/identifiers/list/serviceId',
    atlassian: 'https://developer.atlassian.com/console/myapps/',
    cognito: 'https://console.aws.amazon.com/cognito/',
    discord: 'https://discord.com/developers/applications',
    facebook: 'https://developers.facebook.com/apps/',
    figma: 'https://www.figma.com/developers/apps',
    github: 'https://github.com/settings/developers',
    microsoft: 'https://aka.ms/appregistrations',
    google: 'https://console.cloud.google.com/apis/credentials',
    huggingface: 'https://huggingface.co/settings/applications',
    slack: 'https://api.slack.com/apps',
    spotify: 'https://developer.spotify.com/dashboard',
    twitch: 'https://dev.twitch.tv/console/apps',
    twitter: 'https://developer.x.com/en/portal/dashboard',
    dropbox: 'https://www.dropbox.com/developers/apps',
    kick: 'https://kick.com/settings/developer',
    linear: 'https://linear.app/settings/api/applications',
    linkedin: 'https://www.linkedin.com/developers/apps',
    gitlab: 'https://gitlab.com/-/user_settings/applications',
    tiktok: 'https://developers.tiktok.com/apps',
    reddit: 'https://www.reddit.com/prefs/apps',
    roblox: 'https://create.roblox.com/dashboard/credentials',
    vk: 'https://dev.vk.com/',
    zoom: 'https://marketplace.zoom.us/develop/create',
    notion: 'https://www.notion.so/my-integrations',
    kakao: 'https://developers.kakao.com/console/app',
    naver: 'https://developers.naver.com/apps/',
    line: 'https://developers.line.biz/console/',
    paypal: 'https://developer.paypal.com/dashboard/applications',
    vercel: 'https://vercel.com/dashboard/integrations/console',
    wechat: 'https://open.weixin.qq.com/',
};

//----------------------------------------------------------------------------------------------------------------------

export function providerLabel(provider : SocialProviderID) : string
{
    return LABEL_OVERRIDES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function providerIcon(provider : SocialProviderID) : string
{
    return ICON_OVERRIDES[provider] ?? `i-simple-icons-${ provider }`;
}

export function providerConsoleURL(provider : SocialProviderID) : string | null
{
    return CONSOLE_URLS[provider] ?? null;
}

//----------------------------------------------------------------------------------------------------------------------
