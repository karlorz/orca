import { TERMINAL_LIFECYCLE_METHODS } from './terminal/terminal-lifecycle-methods'
import { TERMINAL_MULTIPLEX_METHODS } from './terminal/terminal-multiplex-method'
import { TERMINAL_QUERY_METHODS } from './terminal/terminal-query-methods'
import { TERMINAL_SEND_METHODS } from './terminal/terminal-send-method'
import { TERMINAL_SUBSCRIBE_METHODS } from './terminal/terminal-subscribe-method'
import {
  TERMINAL_VIEWPORT_METHODS_AFTER_STREAMS,
  TERMINAL_VIEWPORT_METHODS_BEFORE_STREAMS
} from './terminal/terminal-viewport-methods'
import { TERMINAL_VIEWER_COLORS_METHODS } from './terminal/terminal-viewer-colors-method'
import { TERMINAL_QUESTION_ANSWER_METHODS } from './terminal/terminal-question-answer-method'
import { TERMINAL_SESSION_NAVIGATION_METHODS } from './terminal/terminal-session-navigation-methods'
import { TERMINAL_ORIGINATING_PANE_METHODS } from './terminal/terminal-originating-pane-methods'

// The manifest order is part of the released RPC contract. Keep composition here so the
// public entry point owns registration rather than forwarding an aggregated child export.
export const TERMINAL_METHODS = [
  ...TERMINAL_QUERY_METHODS,
  ...TERMINAL_SEND_METHODS,
  ...TERMINAL_LIFECYCLE_METHODS,
  ...TERMINAL_VIEWPORT_METHODS_BEFORE_STREAMS,
  ...TERMINAL_MULTIPLEX_METHODS,
  ...TERMINAL_SUBSCRIBE_METHODS,
  ...TERMINAL_VIEWPORT_METHODS_AFTER_STREAMS,
  ...TERMINAL_VIEWER_COLORS_METHODS,
  ...TERMINAL_SESSION_NAVIGATION_METHODS,
  ...TERMINAL_QUESTION_ANSWER_METHODS,
  ...TERMINAL_ORIGINATING_PANE_METHODS
]
