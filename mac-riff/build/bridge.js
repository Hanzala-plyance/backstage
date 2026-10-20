const usb = require('usb');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const VID = 0x0e6f; // PDP
const PIDS = [0x024c, 0x0248]; // Riffmaster Dongle PIDs

const DEBUG = process.env.DEBUG === 'true' || process.argv.includes('--debug');
const NO_SPECIAL = process.argv.includes('--no-special');
const CONTROLLER = process.argv.includes('--controller');
const socketArg = process.argv.indexOf('--socket');
const eventPipeIndex = process.argv.indexOf('--event-pipe');
const eventPipePath = eventPipeIndex >= 0 ? process.argv[eventPipeIndex + 1] : null;
if (eventPipeIndex >= 0 && (!eventPipePath || eventPipePath.startsWith('--'))) {
    throw new Error('--event-pipe requires the MacRiff app event pipe path.');
}

// Device mapping configurations
const MAPPINGS = [
  { name: 'Green Fret',    byte: 4, bit: 0x10, keyCode: 0   }, // A
  { name: 'Red Fret',      byte: 4, bit: 0x20, keyCode: 1   }, // S
  { name: 'Yellow Fret',   byte: 4, bit: 0x80, keyCode: 38  }, // J (mapped to Y)
  { name: 'Blue Fret',     byte: 4, bit: 0x40, keyCode: 40  }, // K (mapped to X)
  { name: 'Orange Fret',   byte: 5, bit: 0x10, keyCode: 37  }, // L (mapped to LB)
  { name: 'Strum UP',      byte: 5, bit: 0x01, keyCode: 126 }, // Up Arrow
  { name: 'Strum DOWN',    byte: 5, bit: 0x02, keyCode: 125 }, // Down Arrow
  { name: 'D-pad Left',    byte: 5, bit: 0x04, keyCode: 123 }, // Left Arrow
  { name: 'D-pad Right',   byte: 5, bit: 0x08, keyCode: 124 }, // Right Arrow
  { name: 'Start/Options', byte: 4, bit: 0x04, keyCode: 36  }, // Enter
  { name: 'Select/Share',  byte: 4, bit: 0x08, keyCode: 53  }  // Escape
];

// Initialize button states
const lastState = {};
for (const mapping of MAPPINGS) {
    lastState[mapping.name] = false;
}

// Analog Whammy bar and Tilt state tracking
const WHAMMY_REST = 0x44; // resting position (~68)
const WHAMMY_DEADZONE = 12; // deadzone to prevent drift
let lastScrollTime = 0;
let lastTiltState = false;


// The menu app posts events in its own GUI session. Keep the C helper for CLI use.
let injector;
let controllerOutput;
if (CONTROLLER) {
    const { createControllerOutput } = require('./controller-output');
    controllerOutput = createControllerOutput(socketArg < 0 ? null : process.argv[socketArg + 1], cleanupAndExit);
} else if (eventPipePath) {
    if (!fs.lstatSync(eventPipePath).isFIFO()) {
        throw new Error('The keyboard event destination must be a named pipe.');
    }
    const fd = fs.openSync(eventPipePath, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    const stream = fs.createWriteStream(null, { fd });
    stream.on('error', (err) => {
        console.error(`[Keyboard Output] Could not send input to MacRiff: ${err.message}`);
        process.exit(1);
    });
    injector = { stdin: stream, kill: () => stream.destroy() };
    console.log('[Keyboard Output] Connected to MacRiff app. The app sends keys using its Accessibility permission.');
} else {
// Spawn the C-based key injector helper for standalone use.
const injectorPath = path.join(__dirname, 'injector');
const spawnOptions = {
    stdio: ['pipe', 'ignore', 'inherit']
};

// If running as root (sudo/do shell script), drop privileges of the injector subprocess 
// to the graphical console user so that CGEventPost reaches the user's active GUI session.
if (process.getuid && process.getuid() === 0) {
    try {
        const { execSync } = require('child_process');
        const username = execSync("stat -f '%Su' /dev/console", { encoding: 'utf8' }).trim();
        if (username && username !== 'root') {
            const uid = parseInt(execSync(`id -u "${username}"`, { encoding: 'utf8' }).trim(), 10);
            const gid = parseInt(execSync(`id -g "${username}"`, { encoding: 'utf8' }).trim(), 10);
            if (!isNaN(uid) && !isNaN(gid)) {
                spawnOptions.uid = uid;
                spawnOptions.gid = gid;
                if (DEBUG) {
                    console.log(`[Init] Dropping injector privileges to GUI user "${username}" (UID: ${uid}, GID: ${gid}) to enable event injection.`);
                }
            }
        }
    } catch (err) {
        console.warn(`[Warning] Could not drop injector privileges to console user: ${err.message}`);
    }
}

injector = spawn(injectorPath, [], spawnOptions);

injector.on('error', (err) => {
    console.error(`[Injector] Could not start keyboard helper: ${err.message}`);
    process.exit(1);
});

injector.on('exit', (code, signal) => {
    console.error(`[Injector] Keyboard helper exited ${signal ? `with signal ${signal}` : `with code ${code}`}`);
    process.exit(code || 1);
});
}

// Helper function to send virtual key events to the C helper
function sendKeyEvent(keyCode, isPressed) {
    if (DEBUG) {
        console.log(`[Virtual Event] Keycode ${keyCode} -> ${isPressed ? 'DOWN' : 'UP'}`);
    }
    if (injector && injector.stdin && injector.stdin.writable) {
        injector.stdin.write(`K ${keyCode} ${isPressed ? 1 : 0}\n`);
    }
}

// Find device
const activePids = CONTROLLER ? [0x0248] : PIDS;
console.log(`Searching for PDP Riffmaster Dongle (VID: 0x${VID.toString(16)}, PIDs: ${activePids.map(p => '0x' + p.toString(16)).join(', ')})...`);
let device;
if (CONTROLLER) {
    const { selectReceiver } = require('./receiver-selector');
    const index = process.argv.indexOf('--device');
    try { device = selectReceiver(usb.getDeviceList(), index < 0 ? null : process.argv[index + 1]); }
    catch (error) { console.error(error.message); process.exit(1); }
} else {
    for (const pid of activePids) {
        device = usb.findByIds(VID, pid);
        if (device) break;
    }
}

if (!device) {
    console.error(`\n[Error] PDP Riffmaster Dongle NOT found!`);
    console.log("Currently connected USB devices:");
    const list = usb.getDeviceList();
    list.forEach((dev) => {
        try {
            console.log(`- VID: 0x${dev.deviceDescriptor.idVendor.toString(16).padStart(4, '0')}, PID: 0x${dev.deviceDescriptor.idProduct.toString(16).padStart(4, '0')}`);
        } catch (e) {
            // ignore descriptors we can't read
        }
    });
    console.log("\nPlease ensure the wireless dongle is plugged in.");
    process.exit(1);
}

console.log("Device found! Opening connection...");
device.open();
if (CONTROLLER) {
    usb.usb.on('detach', removed => {
        if (removed.busNumber === device.busNumber && removed.deviceAddress === device.deviceAddress) {
            console.warn('[USB] Receiver unplugged. Reconnecting automatically to the same port.');
            cleanupAndExit(1);
        }
    });
}

let iface;
let endpoint;
let wasKernelDriverActive = false;

console.log("Setting active USB configuration 1...");
device.setConfiguration(1, (err) => {
    if (err) {
        console.error(`[Error] Failed to set active configuration: ${err.message}`);
        console.error("Please run the script with 'sudo' (e.g., sudo node bridge.js).");
        try { device.close(); } catch (e) {}
        process.exit(1);
    }

    try {
        iface = device.interface(0);
    } catch (ifaceErr) {
        console.error(`[Error] Failed to get interface 0: ${ifaceErr.message}`);
        console.error("Please ensure the script is run with 'sudo' (e.g., sudo node bridge.js).");
        try { device.close(); } catch (e) {}
        process.exit(1);
    }

    // Detach kernel driver if active (macOS support varies)
    try {
        if (typeof iface.isKernelDriverActive === 'function' && iface.isKernelDriverActive()) {
            console.log("Kernel driver is active. Attempting to detach...");
            iface.detachKernelDriver();
            wasKernelDriverActive = true;
            console.log("Kernel driver detached.");
        } else {
            console.log("No active kernel driver detected, or not supported on this platform.");
        }
    } catch (detachErr) {
        console.warn(`[Warning] Could not detach kernel driver: ${detachErr.message}`);
    }

    // Claim the interface
    console.log("Claiming interface 0...");
    try {
        iface.claim();
        console.log("Interface 0 claimed successfully.");
    } catch (claimErr) {
        console.error(`[Error] Failed to claim interface: ${claimErr.message}`);
        console.error("Please run the script with 'sudo' (e.g., sudo node bridge.js).");
        try { device.close(); } catch (e) {}
        process.exit(1);
    }

    // Locate primary Interrupt IN endpoint
    endpoint = iface.endpoints.find(
        ep => ep.direction === 'in' && ep.transferType === usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT
    );

    if (!endpoint) {
        console.error("[Error] Interrupt IN Endpoint not found on Interface 0!");
        cleanupAndExit(1);
        return;
    }

    // Locate primary Interrupt OUT endpoint
    const outEndpoint = iface.endpoints.find(
        ep => ep.direction === 'out' && ep.transferType === usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT
    );

    console.log(`Found Interrupt IN Endpoint at address 0x${endpoint.address.toString(16)} (Max Packet Size: ${endpoint.descriptor.wMaxPacketSize} bytes).`);
    
    let sequence = 0;
    function getNextSequence() {
        sequence = (sequence + 1) & 0xff;
        if (sequence === 0) sequence = 1;
        return sequence;
    }

    let handshakeRunning = false;
    function sendGIPHandshake() {
        if (exiting || handshakeRunning) return;
        if (!outEndpoint) {
            console.warn("[Warning] Interrupt OUT Endpoint not found. Skipping handshake.");
            return;
        }

        if (DEBUG) {
            console.log("Sending GIP handshake sequence...");
        }

        handshakeRunning = true;
        const packets = [
            // 1. Identify Request (0x04, 0x20, seq, 0x00)
            () => Buffer.from([0x04, 0x20, getNextSequence(), 0x00]),
            // 2. Power On (0x05, 0x20, seq, 0x01, 0x00)
            () => Buffer.from([0x05, 0x20, getNextSequence(), 0x01, 0x00]),
            // 3. Enable LED (0x0a, 0x20, seq, 0x03, 0x00, 0x01, 0x14)
            () => Buffer.from([0x0a, 0x20, getNextSequence(), 0x03, 0x00, 0x01, 0x14]),
            // 4. Security Passed (0x06, 0x20, seq, 0x02, 0x01, 0x00)
            () => Buffer.from([0x06, 0x20, getNextSequence(), 0x02, 0x01, 0x00]),
            // 5. Rumble Init (0x09, 0x00, seq, 0x09, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0xeb)
            () => Buffer.from([0x09, 0x00, getNextSequence(), 0x09, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0xeb])
        ];

        let idx = 0;
        function sendNext() {
            if (exiting) { handshakeRunning = false; return; }
            if (idx >= packets.length) {
                handshakeRunning = false;
                if (DEBUG) {
                    console.log("GIP handshake sequence sent.");
                }
                return;
            }
            const pkt = packets[idx++];
            outEndpoint.transfer(pkt(), (writeErr) => {
                if (writeErr) {
                    console.warn(`[Warning] Handshake transfer failed (index: ${idx}): ${writeErr.message}`);
                    if (CONTROLLER) { handshakeRunning = false; cleanupAndExit(1); return; }
                } else if (DEBUG) {
                    console.log(`[Handshake Out] Sent: ${pkt().toString('hex')}`);
                }
                setTimeout(sendNext, 20);
            });
        }
        sendNext();
    }

    if (outEndpoint) {
        console.log(`Found Interrupt OUT Endpoint at address 0x${outEndpoint.address.toString(16)}.`);
        sendGIPHandshake();
    } else {
        console.warn("[Warning] Interrupt OUT Endpoint not found. GIP handshake skipped.");
    }

    console.log("Starting packet polling... Press Ctrl+C to exit.");

    // Start polling using the exact endpoint packet size
    endpoint.startPoll(1, endpoint.descriptor.wMaxPacketSize);

    let lastData = null;

    endpoint.on('data', (data) => {
        if (data.length < 4) {
            return;
        }

        const cmd = data[0];

        // GIP Announce (0x02): Device arrival / connection broadcast
        if (cmd === 0x02) {
            if (DEBUG) {
                console.log(`[Raw Announce Packet] length=${data.length} bytes: ${data.toString('hex')}`);
            }
            console.log("Device announcement received. Re-sending handshake sequence...");
            sendGIPHandshake();
            return;
        }

        // GIP Input (0x20): Standard gamepad input report
        if (cmd === 0x20) {
            if (DEBUG) {
                // If DEBUG is active, track and log ONLY the changed bytes to avoid console spamming
                if (!lastData || lastData.length !== data.length) {
                    lastData = Buffer.from(data);
                    console.log(`[Raw Input Packet] length=${data.length} bytes: ${data.toString('hex')}`);
                } else {
                    const changes = [];
                    for (let index = 0; index < data.length; index++) {
                        if (data[index] !== lastData[index]) {
                            changes.push(`Byte ${index}: 0x${lastData[index].toString(16).padStart(2, '0')} -> 0x${data[index].toString(16).padStart(2, '0')}`);
                            lastData[index] = data[index];
                        }
                    }
                    if (changes.length > 0) {
                        console.log(`[Input Changed] ${changes.join(', ')}`);
                    }
                }
            }

            if (data.length < 6) {
                return;
            }

            if (controllerOutput) {
                controllerOutput.send(data, NO_SPECIAL);
                return;
            }

            for (const mapping of MAPPINGS) {
                const isPressed = (data[mapping.byte] & mapping.bit) !== 0;
                const previousState = lastState[mapping.name];

                if (isPressed !== previousState) {
                    lastState[mapping.name] = isPressed;
                    console.log(`[Input State] ${mapping.name}: ${isPressed ? 'PRESSED' : 'RELEASED'}`);
                    if (!controllerOutput) sendKeyEvent(mapping.keyCode, isPressed);
                }
            }

            // Handle Whammy Bar (analog on Byte 7, mapping to Scroll Wheel events)
            if (!NO_SPECIAL && data.length > 7) {
                const whammyVal = data[7];
                const delta = whammyVal - WHAMMY_REST;
                if (Math.abs(delta) > WHAMMY_DEADZONE) {
                    const scrollSpeed = Math.round(delta / 16);
                    if (scrollSpeed !== 0) {
                        const now = Date.now();
                        // Throttle events to max 60Hz to avoid event queue saturation
                        if (now - lastScrollTime >= 16) {
                            lastScrollTime = now;
                            if (DEBUG) {
                                console.log(`[Virtual Event] Scroll Delta: ${scrollSpeed} (raw: 0x${whammyVal.toString(16)})`);
                            }
                            if (injector.stdin && injector.stdin.writable) {
                                injector.stdin.write(`S ${scrollSpeed}\n`);
                            }
                        }
                    }
                }
            }

            // Handle Tilt Sensor (analog on Byte 6, mapping to Spacebar for Star Power)
            if (!NO_SPECIAL && data.length > 6) {
                const tiltVal = data[6];
                const isTilted = tiltVal >= 0x70; // 112 in decimal
                if (isTilted !== lastTiltState) {
                    lastTiltState = isTilted;
                    console.log(`[Input State] Tilt Sensor: ${isTilted ? 'PRESSED' : 'RELEASED'} (raw value: 0x${tiltVal.toString(16)})`);
                    sendKeyEvent(49, isTilted); // Spacebar (49)
                }
            }
        } else if (DEBUG) {
            // Other GIP messages (e.g. status 0x03, auth 0x06, etc.)
            console.log(`[GIP Packet 0x${cmd.toString(16).padStart(2, '0')}] length=${data.length} bytes: ${data.toString('hex')}`);
        }
    });

    endpoint.on('error', (endpointErr) => {
        console.error(`[Endpoint Error] ${endpointErr.message}`);
        if (CONTROLLER) cleanupAndExit(1);
    });
});

// Setup clean exit handler
let exiting = false;
function cleanupAndExit(exitCode = 0) {
    if (exiting) return;
    exiting = true;
    // A removed USB device can leave libusb callbacks unresolved. Bound cleanup.
    setTimeout(() => process.exit(exitCode), 2000).unref();
    if (controllerOutput) controllerOutput.close();
    
    console.log("\n[Shutdown] Releasing USB interface and cleaning up...");
    
    if (endpoint) {
        try {
            endpoint.stopPoll(() => {
                performRelease();
            });
        } catch (e) {
            performRelease();
        }
    } else {
        performRelease();
    }

    function performRelease() {
        if (iface) {
            try {
                iface.release(true, (releaseErr) => {
                    if (releaseErr) {
                        console.error(`[Shutdown Error] Failed to release interface: ${releaseErr.message}`);
                    } else {
                        console.log("[Shutdown] Interface released.");
                    }

                    // Try to re-attach kernel driver if we detached it
                    if (wasKernelDriverActive) {
                        try {
                            iface.attachKernelDriver();
                            console.log("[Shutdown] Kernel driver re-attached.");
                        } catch (e) {
                            console.warn(`[Shutdown Warning] Could not re-attach kernel driver: ${e.message}`);
                        }
                    }

                    try {
                        device.close();
                        console.log("[Shutdown] USB connection closed.");
                    } catch (closeErr) {
                        console.error(`[Shutdown Error] Error closing device: ${closeErr.message}`);
                    }

                    // Terminate injector helper
                    if (injector) injector.kill('SIGTERM');
                    process.exit(exitCode);
                });
            } catch (err) {
                console.error(`[Shutdown Error] Error during release: ${err.message}`);
                if (injector) injector.kill('SIGTERM');
                process.exit(1);
            }
        } else {
            try {
                if (device) {
                    device.close();
                    console.log("[Shutdown] USB connection closed.");
                }
            } catch (closeErr) {}
            if (injector) injector.kill('SIGTERM');
            process.exit(exitCode);
        }
    }
}

process.on('SIGINT', () => {
    cleanupAndExit(0);
});

process.on('SIGTERM', () => {
    cleanupAndExit(0);
});
