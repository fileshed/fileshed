//----------------------------------------------------------------------------------------------------------------------
// Router
//----------------------------------------------------------------------------------------------------------------------

import { createRouter, createWebHistory } from 'vue-router';

// Layouts
import MainLayout from '../layouts/mainLayout.vue';

// Pages
import SignInPage from '../pages/signInPage.vue';
import SignUpPage from '../pages/signUpPage.vue';
import DrivePage from '../pages/drivePage.vue';
import SharedPage from '../pages/sharedPage.vue';
import TrashPage from '../pages/trashPage.vue';
import SearchPage from '../pages/searchPage.vue';
import AccountPage from '../pages/accountPage.vue';
import AdminPage from '../pages/adminPage.vue';

// Stores
import { useSessionStore } from '../stores/session.ts';

// Router
import { createAuthGuard } from './guard.ts';

//----------------------------------------------------------------------------------------------------------------------

export const router = createRouter({
    history: createWebHistory(),
    routes: [
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
                { path: 'account', name: 'account', component: AccountPage },
                { path: 'admin', name: 'admin', component: AdminPage, meta: { admin: true } },
            ],
        },
    ],
});

// useSessionStore is resolved lazily inside the guard so Pinia is already installed by the time it runs.
const guard = createAuthGuard(useSessionStore);
router.beforeEach((to) => guard(to));

//----------------------------------------------------------------------------------------------------------------------
