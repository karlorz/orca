import { defineMethod } from '../core'
import {
  DELEGATED_MOBILE_DEVICE_SYNC_METHOD,
  DelegatedMobileDeviceSyncParamsSchema
} from '../../../../shared/delegated-mobile-device-contract'
import { RegisterDeviceKeyParamsSchema } from '../../../../shared/device-key-registration-contract'
import { REGISTER_DEVICE_KEY_METHOD } from '../../../../shared/device-key-capability'
import {
  PairingGetEndpointsParamsSchema,
  PairingProvisionRelayParamsSchema
} from '../../../../shared/mobile-relay-credential-contract'
import {
  MOBILE_PAIRING_CREATE_OFFER_METHOD,
  MOBILE_PAIRING_OFFER_UNAVAILABLE_CODE,
  PairingCreateMobileOfferParamsSchema
} from '../../../../shared/mobile-pairing-offer-contract'
import {
  PairingCreateRuntimeOfferParamsSchema,
  RUNTIME_PAIRING_CREATE_OFFER_METHOD,
  RUNTIME_PAIRING_OFFER_UNAVAILABLE_CODE
} from '../../../../shared/runtime-pairing-offer-contract'

export const PAIRING_METHODS = [
  defineMethod({
    name: 'pairing.getEndpoints',
    permission: 'pairing-admin',
    params: PairingGetEndpointsParamsSchema,
    handler: async (params, ctx) => {
      if (!ctx.pairing?.getEndpoints) {
        throw new Error('pairing_context_unavailable')
      }
      return await ctx.pairing.getEndpoints(params)
    }
  }),
  defineMethod({
    name: MOBILE_PAIRING_CREATE_OFFER_METHOD,
    permission: 'pairing-admin',
    params: PairingCreateMobileOfferParamsSchema,
    handler: async (params, ctx) => {
      if (!ctx.mobilePairingOffers) {
        throw Object.assign(
          new Error(
            'Mobile pairing offers are available only on the local desktop runtime. Use the desktop app for a phone QR, or run `orca pairing offer --scope runtime` on this host.'
          ),
          { code: MOBILE_PAIRING_OFFER_UNAVAILABLE_CODE }
        )
      }
      return await ctx.mobilePairingOffers.create(params)
    }
  }),
  defineMethod({
    name: RUNTIME_PAIRING_CREATE_OFFER_METHOD,
    permission: 'pairing-admin',
    params: PairingCreateRuntimeOfferParamsSchema,
    handler: (params, ctx) => {
      if (!ctx.pairing?.createOffer) {
        throw Object.assign(
          new Error(
            'Runtime pairing offers are minted on the host that is serving. Run `orca pairing offer --scope runtime` on that machine after updating it.'
          ),
          { code: RUNTIME_PAIRING_OFFER_UNAVAILABLE_CODE }
        )
      }
      return ctx.pairing.createOffer(params)
    }
  }),
  defineMethod({
    name: 'pairing.provisionRelay',
    permission: 'pairing-admin',
    params: PairingProvisionRelayParamsSchema,
    handler: async (params, ctx) => {
      if (!ctx.pairing?.provisionRelay) {
        throw new Error('pairing_context_unavailable')
      }
      return await ctx.pairing.provisionRelay(params)
    }
  }),
  defineMethod({
    name: REGISTER_DEVICE_KEY_METHOD,
    permission: 'device-self',
    params: RegisterDeviceKeyParamsSchema,
    handler: (params, ctx) => {
      if (!ctx.deviceSelf) {
        throw new Error('device_key_registration_unavailable')
      }
      return ctx.deviceSelf.registerDeviceKey(params)
    }
  }),
  defineMethod({
    name: DELEGATED_MOBILE_DEVICE_SYNC_METHOD,
    // Paired desktops lack pairing-admin but must manage their children within rpc-caller-scope.
    permission: 'workspace',
    params: DelegatedMobileDeviceSyncParamsSchema,
    handler: (params, ctx) => {
      if (!ctx.delegatedMobileDevices) {
        throw new Error('runtime_device_required')
      }
      return ctx.delegatedMobileDevices.sync(params.phones)
    }
  })
]
