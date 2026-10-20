import { useEffect, useRef } from 'react'
import { Animated } from 'react-native'

/** Desktop's `animate-pulse` on a live run's sentence. One element either way, so the
 *  header never remounts as the run settles. */
export function PulsingText({
  pulsing,
  style,
  children
}: {
  pulsing: boolean
  style?: React.ComponentProps<typeof Animated.Text>['style']
  children: React.ReactNode
}): React.JSX.Element {
  const opacity = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!pulsing) {
      opacity.setValue(1)
      return
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true })
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [opacity, pulsing])
  return (
    <Animated.Text style={[style, { opacity }]} numberOfLines={2}>
      {children}
    </Animated.Text>
  )
}
