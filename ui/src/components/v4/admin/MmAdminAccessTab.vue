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
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="u in users"
              :key="u.userId"
            >
              <td class="mm-admin-mono">{{ u.email }}</td>
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
              </td>
            </tr>
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

const ALLOWED_ROLES = [ROLE_USER, ROLE_SUPPORT]

async function load() {
  loading.value = true
  error.value = null
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
</style>
