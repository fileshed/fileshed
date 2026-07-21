//----------------------------------------------------------------------------------------------------------------------
// Router
//----------------------------------------------------------------------------------------------------------------------

import { createRouter, createWebHistory } from 'vue-router';

// Layouts
import MainLayout from '../layouts/mainLayout.vue';

// Views
import SignInView from '../views/signInView.vue';
import SignUpView from '../views/signUpView.vue';
import DriveView from '../views/driveView.vue';
import SharedView from '../views/sharedView.vue';
import TrashView from '../views/trashView.vue';
import SearchView from '../views/searchView.vue';
import AccountView from '../views/accountView.vue';
import AdminView from '../views/adminView.vue';

// Stores
import { useSessionStore } from '../stores/session.ts';

// Router
import { createAuthGuard } from './guard.ts';

//----------------------------------------------------------------------------------------------------------------------

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/signin', name: 'signin', component: SignInView, meta: { public: true } },
        { path: '/signup', name: 'signup', component: SignUpView, meta: { public: true } },
        {
            path: '/',
            component: MainLayout,
            children: [
                { path: '', name: 'drive', component: DriveView },
                { path: 'shared', name: 'shared', component: SharedView },
                { path: 'trash', name: 'trash', component: TrashView },
                { path: 'search', name: 'search', component: SearchView },
                { path: 'account', name: 'account', component: AccountView },
                { path: 'admin', name: 'admin', component: AdminView, meta: { admin: true } },
            ],
        },
    ],
});

// useSessionStore is resolved lazily inside the guard so Pinia is already installed by the time it runs.
const guard = createAuthGuard(useSessionStore);
router.beforeEach((to) => guard(to));

//----------------------------------------------------------------------------------------------------------------------
