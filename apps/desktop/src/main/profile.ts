import type { ApiResult, PhotoType, Profile, ProfileChanges } from '../preload/api-types'
import { request } from './api'

export const getMyProfile = (): Promise<ApiResult<Profile>> => request('GET', '/users/me/profile')

export const getProfile = (userId: string): Promise<ApiResult<Profile>> =>
  request('GET', `/users/${userId}/profile`)

export const updateProfile = (changes: ProfileChanges): Promise<ApiResult<Profile>> =>
  request('PATCH', '/users/me/profile', changes)

export const setPhoto = (
  data: Uint8Array,
  type: PhotoType
): Promise<ApiResult<{ avatarVersion: string }>> =>
  request('PUT', '/users/me/avatar', undefined, { data, type })

export const removePhoto = (): Promise<ApiResult<{ avatarVersion: null }>> =>
  request('DELETE', '/users/me/avatar')

/** Your own name for someone (only you see it). Null removes it. */
export const setNickname = (
  userId: string,
  nickname: string | null
): Promise<ApiResult<{ userId: string; nickname: string | null }>> =>
  request('PUT', `/users/${userId}/nickname`, { nickname })
