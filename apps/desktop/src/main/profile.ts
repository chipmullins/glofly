import type { ActivityItem, ApiResult, Mutuals, PhotoType, Profile, ProfileChanges, ProfileHeader } from '../preload/api-types'
import { request } from './api'

/** 0.9.1: `as` = preview what a friend / anyone else sees. */
export const getMyProfile = (as?: 'friend' | 'everyone'): Promise<ApiResult<Profile>> =>
  request('GET', as ? `/users/me/profile?as=${as}` : '/users/me/profile')

export const getProfile = (userId: string): Promise<ApiResult<Profile>> =>
  request('GET', `/users/${userId}/profile`)

export const updateProfile = (changes: ProfileChanges): Promise<ApiResult<Profile>> =>
  request('PATCH', '/users/me/profile', changes)

export const setPhoto = (
  data: Uint8Array,
  type: PhotoType
): Promise<ApiResult<{ avatarVersion: string }>> =>
  request('PUT', '/users/me/avatar', undefined, { data, type })

/** 0.9.1: a header image for your profile card. */
export const setHeader = (
  data: Uint8Array,
  type: PhotoType
): Promise<ApiResult<{ header: ProfileHeader }>> =>
  request('PUT', '/users/me/header', undefined, { data, type })

export const removeHeader = (): Promise<ApiResult<{ header: null }>> =>
  request('DELETE', '/users/me/header')

export const getMutuals = (userId: string): Promise<ApiResult<Mutuals & { shown: boolean }>> =>
  request('GET', `/users/${userId}/mutuals`)

export const getActivity = (
  userId: string,
  as?: 'friend' | 'everyone'
): Promise<ApiResult<{ shown: boolean; items: ActivityItem[] }>> =>
  request('GET', `/users/${userId}/activity${as ? `?as=${as}` : ''}`)

export const removePhoto = (): Promise<ApiResult<{ avatarVersion: null }>> =>
  request('DELETE', '/users/me/avatar')

/** Your own name for someone (only you see it). Null removes it. */
export const setNickname = (
  userId: string,
  nickname: string | null
): Promise<ApiResult<{ userId: string; nickname: string | null }>> =>
  request('PUT', `/users/${userId}/nickname`, { nickname })
