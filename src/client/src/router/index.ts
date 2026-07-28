//----------------------------------------------------------------------------------------------------------------------
// Router
//----------------------------------------------------------------------------------------------------------------------

import { type RouteRecordRaw, createRouter, createWebHistory } from 'vue-router';

// Layouts
import MainLayout from '../layouts/mainLayout.vue';
import AccountLayout from '../layouts/accountLayout.vue';
import AdminLayout from '../layouts/adminLayout.vue';
import EditorLayout from '../layouts/editorLayout.vue';

// Pages
import SetupPage from '../pages/setupPage.vue';
import SignInPage from '../pages/signInPage.vue';
import SignUpPage from '../pages/signUpPage.vue';
import DrivePage from '../pages/drivePage.vue';
import FilePage from '../pages/filePage.vue';
import SharedPage from '../pages/sharedPage.vue';
import TrashPage from '../pages/trashPage.vue';
import SearchPage from '../pages/searchPage.vue';
import ProfileTab from '../pages/account/profileTab.vue';
import SettingsTab from '../pages/account/settingsTab.vue';
import AccountTab from '../pages/account/accountTab.vue';
import TokensTab from '../pages/account/tokensTab.vue';
import AdminUsersTab from '../pages/admin/usersTab.vue';
import AdminSettingsTab from '../pages/admin/settingsTab.vue';
import AdminEmailTab from '../pages/admin/emailTab.vue';
import AdminAuthenticationTab from '../pages/admin/authenticationTab.vue';
import AdminBrandingTab from '../pages/admin/brandingTab.vue';
import AdminStatusTab from '../pages/admin/statusTab.vue';

// Stores
import { useSessionStore } from '../stores/session.ts';

// Router
import { createAuthGuard } from './guard.ts';

//----------------------------------------------------------------------------------------------------------------------

export const routes : RouteRecordRaw[] = [
    { path: '/setup', name: 'setup', component: SetupPage, meta: { public: true } },
    { path: '/signin', name: 'signin', component: SignInPage, meta: { public: true } },
    { path: '/signup', name: 'signup', component: SignUpPage, meta: { public: true } },
    {
        path: '/',
        component: MainLayout,
        children: [
            { path: '', name: 'drive', component: DrivePage },
            { path: 'folder/:id', name: 'folder', component: DrivePage },
            { path: 'shared', name: 'shared', component: SharedPage },
            { path: 'trash', name: 'trash', component: TrashPage },
            { path: 'search', name: 'search', component: SearchPage },
        ],
    },
    {
        path: '/admin',
        component: AdminLayout,
        meta: { admin: true },
        children: [
            { path: '', redirect: { name: 'admin-users' } },
            { path: 'users', name: 'admin-users', component: AdminUsersTab },
            { path: 'settings', name: 'admin-settings', component: AdminSettingsTab },
            { path: 'email', name: 'admin-email', component: AdminEmailTab },
            { path: 'authentication', name: 'admin-authentication', component: AdminAuthenticationTab },
            { path: 'branding', name: 'admin-branding', component: AdminBrandingTab },
            { path: 'status', name: 'admin-status', component: AdminStatusTab },
        ],
    },
    {
        path: '/file/:id',
        component: EditorLayout,
        children: [
            { path: '', name: 'file', component: FilePage },
        ],
    },
    {
        path: '/account',
        component: AccountLayout,
        children: [
            { path: '', redirect: { name: 'account-profile' } },
            { path: 'profile', name: 'account-profile', component: ProfileTab },
            { path: 'settings', name: 'account-settings', component: SettingsTab },
            { path: 'account', name: 'account-account', component: AccountTab },
            { path: 'tokens', name: 'account-tokens', component: TokensTab },
        ],
    },
];

export const router = createRouter({
    history: createWebHistory(),
    routes,
});

// useSessionStore is resolved lazily inside the guard so Pinia is already installed by the time it runs.
const guard = createAuthGuard(useSessionStore);
router.beforeEach((to) => guard(to));

//----------------------------------------------------------------------------------------------------------------------
