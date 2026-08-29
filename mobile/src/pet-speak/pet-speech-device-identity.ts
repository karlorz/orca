import { Platform } from 'react-native'

export function getFriendlyDeviceModelName(): string {
  if (Platform.OS === 'android') {
    const constants = Platform.constants as Record<string, unknown> | undefined
    const androidModel = constants?.Model ?? constants?.Brand ?? constants?.Manufacturer
    if (typeof androidModel === 'string' && androidModel.trim().length > 0) {
      return androidModel.trim()
    }
    return 'Android Device'
  }
  if (Platform.OS === 'ios') {
    const constants = Platform.constants as Record<string, unknown> | undefined
    const iosModel = constants?.Model
    if (typeof iosModel === 'string' && iosModel.trim().length > 0) {
      return iosModel.trim()
    }
    return 'iOS Device'
  }
  return 'Orca Client'
}
