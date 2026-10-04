// Public browser configuration. Never put private API keys here.
window.OCTAGON_CONFIG = {
  peer: {}, // Default: public PeerJS signaling. Self-host example in README.
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    // For restrictive networks add a TURN server with short-lived credentials.
  ],
};
