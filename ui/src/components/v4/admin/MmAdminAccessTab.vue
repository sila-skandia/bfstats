<template>
  <section class="mm-admin-card">
    <div class="mm-admin-card__head mm-admin-access__head">
      <h3 class="mm-admin-card__title mm-admin-card__title--strong">
        Access
      </h3>
      <button
        type="button"
        class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
        :disabled="loading"
        @click="load"
      >
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </div>

    <div class="mm-admin-card__body mm-admin-access__body">
      <p class="mm-admin-access__desc">
        Assign User or Support. Admin is fixed. Only admins can change roles.
      </p>

      <div v-if="error" class="mm-admin-alert mm-admin-alert--err">
        {{ error }}
      </div>

      <div v-if="users.length === 0 && !loading" class="mm-admin-empty">
        <span class="mm-admin-empty__title">No users</span>
        <span class="mm-admin-empty__desc">Users appear after they sign in.</span>
      </div>

      <div v-else class="mm-admin-table-wrap">
        <table class="mm-admin-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Type</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="u in users" :key="u.userId">
              <tr>
                <td class="mm-admin-mono">{{ u.username || u.email }}</td>
                <td>
                  <span v-if="u.authProvider === 'password'" class="mm-admin-access__provider">Password</span>
                  <span v-else-if="u.authProvider === 'deleted'" class="mm-admin-access__provider mm-admin-access__provider--deleted">Erased</span>
                  <span v-else class="mm-admin-access__provider">Discord</span>
                </td>
                <td>
                  <select
                    :value="u.role"
                    :disabled="u.role === 'Admin' || savingId === u.userId"
                    class="mm-admin-select mm-admin-access__select"
                    @change="onRoleChange(u.userId, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="User">User</option>
                    <option value="Support">Support</option>
                    <option value="Admin" disabled>Admin (fixed)</option>
                  </select>
                </td>
                <td>
                  <span v-if="u.role === 'Admin'" class="mm-admin-access__fixed">—</span>
                  <span v-else-if="savingId === u.userId" class="mm-admin-access__saving">Saving…</span>
                  <span v-else-if="saveErrorId === u.userId" class="mm-admin-access__err">{{ saveError }}</span>
                  <button
                    v-else-if="u.authProvider === 'password'"
                    type="button"
                    class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                    :disabled="resettingId === u.userId"
                    @click="onResetPassword(u)"
                  >
                    {{ resettingId === u.userId ? 'Generating…' : 'Reset password' }}
                  </button>
                </td>
              </tr>
              <tr v-if="generated?.userId === u.userId">
                <td colspan="4" class="mm-admin-access__reset-cell">
                  <span class="mm-admin-access__reset-label">
                    Temporary password for {{ generated.username }}. Shown once. Ask them to sign in and change it.
                  </span>
                  <code class="mm-admin-access__reset-password">{{ generated.temporaryPassword }}</code>
                  <button
                    type="button"
                    class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                    @click="copyTempPassword"
                  >{{ copied ? 'Copied' : 'Copy' }}</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <div class="mm-admin-card__foot">
      Users who have signed in. Role takes effect on next login or token refresh.
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { adminDataService, type UserWithRoleResponse } from '@/services/adminDataService'
import { ROLE_USER, ROLE_SUPPORT } from '@/constants/roles'

const users = ref<UserWithRoleResponse[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const savingId = ref<number | null>(null)
const saveError = ref<string | null>(null)
const saveErrorId = ref<number | null>(null)
const resettingId = ref<number | null>(null)
const generated = ref<{ userId: number; username: string; temporaryPassword: string } | null>(null)
const copied = ref(false)

const ALLOWED_ROLES = [ROLE_USER, ROLE_SUPPORT]

async function onResetPassword(u: UserWithRoleResponse) {
  resettingId.value = u.userId
  error.value = null
  generated.value = null
  copied.value = false
  try {
    generated.value = await adminDataService.resetPassword(u.userId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to generate password'
  } finally {
    resettingId.value = null
  }
}

async function copyTempPassword() {
  if (!generated.value) return
  try {
    await navigator.clipboard.writeText(generated.value.temporaryPassword)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // Clipboard blocked; the password stays on screen to copy by hand.
  }
}

async function load() {
  loading.value = true
  error.value = null
  generated.value = null
  try {
    users.value = await adminDataService.listUsers()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load users'
    users.value = []
  } finally {
    loading.value = false
  }
}

async function onRoleChange(userId: number, role: string) {
  if (!ALLOWED_ROLES.includes(role)) return
  savingId.value = userId
  saveError.value = null
  saveErrorId.value = null
  try {
    await adminDataService.setUserRole(userId, role)
    const u = users.value.find((x) => x.userId === userId)
    if (u) u.role = role
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : 'Failed to save'
    saveErrorId.value = userId
  } finally {
    savingId.value = null
  }
}

onMounted(() => load())

defineExpose({ load })
</script>

<style scoped>
.mm-admin-access__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.mm-admin-access__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px 18px;
}

.mm-admin-access__desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--mm-ink-muted);
  line-height: 1.5;
}

.mm-admin-access__select {
  padding: 5px 24px 5px 10px;
  font-size: 12.5px;
  background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
}

.mm-admin-access__fixed {
  font-size: 12px;
  color: var(--mm-ink-faint);
}

.mm-admin-access__saving {
  font-size: 12px;
  color: var(--mm-accent-soft);
}

.mm-admin-access__err {
  font-size: 12px;
  color: var(--mm-danger);
}

.mm-admin-access__provider {
  font-size: 12px;
  color: var(--mm-ink-muted);
}
.mm-admin-access__provider--deleted {
  color: var(--mm-ink-faint);
}

.mm-admin-access__reset-cell {
  background: var(--mm-bg-soft);
  padding: 10px 14px;
  font-size: 12.5px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.mm-admin-access__reset-label {
  color: var(--mm-ink-muted);
  line-height: 1.4;
}

.mm-admin-access__reset-password {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  color: var(--mm-ink);
  letter-spacing: 0.04em;
  user-select: all;
}
</style>
