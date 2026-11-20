# KhanaBanana Security Specification

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document under `/users/{userId}` and its subcollections (`inventory`, `messages`, `recipes`) belongs strictly to `userId == request.auth.uid`. No user can read, list, create, update, or delete another user's data.
2. **Master Gate Integrity**: Subcollection documents (`inventory`, `messages`, `recipes`) require the parent `/users/{userId}` profile document to exist (`exists(...)`), and enforce `userId == request.auth.uid` and `id == documentId`.
3. **Immutable Ownership & Creation Timestamps**: `uid` / `userId` and `createdAt` can never be mutated after creation. `createdAt` and `updatedAt` must match `request.time`.
4. **Strict Key & Size Boundaries**: All writes enforce `hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on updates, type checks, enum checks, and `.size()` bounds on every string and array to prevent shadow fields and payload poisoning.
5. **Path ID Hardening**: All path parameters (`userId`, `itemId`, `messageId`, `recipeId`) must match `^[a-zA-Z0-9_\-]+$` and length `<= 128`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Chat Read**: Unauthenticated client requests `GET /users/userA/messages/msg1` -> `PERMISSION_DENIED`.
2. **Cross-Tenant Profile Snooping**: Authenticated `userB` requests `GET /users/userA` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Inventory List**: Authenticated `userB` runs `LIST /users/userA/inventory` -> `PERMISSION_DENIED`.
4. **Identity Spoofing on Create**: Authenticated `userB` attempts `CREATE /users/userB/inventory/item1` with `{ userId: "userA", ... }` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection on Profile Create**: Authenticated `userA` attempts `CREATE /users/userA` with extra field `{ isAdmin: true }` -> `PERMISSION_DENIED`.
6. **Shadow Field Injection on Profile Update**: Authenticated `userA` attempts `UPDATE /users/userA` adding `{ role: "superadmin" }` -> `PERMISSION_DENIED`.
7. **Immutable Timestamp Tampering**: Authenticated `userA` attempts `CREATE /users/userA` with forged `createdAt` not equal to `request.time` -> `PERMISSION_DENIED`.
8. **Immutable Ownership Mutation**: Authenticated `userA` attempts `UPDATE /users/userA/recipes/rec1` changing `userId` to `"userB"` -> `PERMISSION_DENIED`.
9. **Path ID Poisoning**: Authenticated `userA` attempts `CREATE /users/userA/inventory/invalid$id!with*badchars` -> `PERMISSION_DENIED`.
10. **Oversized String Exhaustion**: Authenticated `userA` attempts `CREATE /users/userA/inventory/item1` with `name` of 500 characters (`> 80`) -> `PERMISSION_DENIED`.
11. **Unbounded Array Injection**: Authenticated `userA` attempts `UPDATE /users/userA` with `recentMeals` array of 50 items (`> 20`) -> `PERMISSION_DENIED`.
12. **Orphan Subcollection Write**: Authenticated `userA` attempts `CREATE /users/userA/messages/msg1` before `/users/userA` parent exists -> `PERMISSION_DENIED`.
