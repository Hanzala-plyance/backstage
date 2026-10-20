// An application-local GameController adapter for Clone Hero.
// Uses Apple's mutable snapshot API; creates no system HID device or key events.
#import <Foundation/Foundation.h>
#import <GameController/GameController.h>
#import <objc/runtime.h>
#include <errno.h>
#include <math.h>
#include <dlfcn.h>
#include <pthread.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

@interface MRSlot : NSObject
@property GCController *guitar;
@property NSString *name;
@property NSString *socketPath;
@property bool gameDetected;
@property bool bridgeConnected;
@property bool transportConnected;
@property double lastInput;
@property bool tilted;
@property unsigned long reportCount;
@property uint32_t observedControls;
@property double previous;
@end
@implementation MRSlot
@end
static NSArray<MRSlot *> *slots;

static void publishStatus(MRSlot *slot, bool connected, bool force) {
    double now = NSDate.date.timeIntervalSince1970;
    if (!force && now - slot.previous < 0.1) return;
    slot.previous = now;
    GCExtendedGamepad *p = slot.guitar.extendedGamepad;
    NSDictionary *status = @{
        @"connected": @(connected), @"transportConnected": @(slot.transportConnected), @"lastInput": @(slot.lastInput), @"gameDetected": @(slot.gameDetected),
        @"reports": @(slot.reportCount), @"updated": @(now), @"observed": @(slot.observedControls),
        @"frets": @[@(p.buttonA.pressed), @(p.buttonB.pressed), @(p.buttonY.pressed), @(p.buttonX.pressed), @(p.leftShoulder.pressed)],
        @"strumUp": @(p.dpad.up.pressed), @"strumDown": @(p.dpad.down.pressed),
        @"whammy": @(p.rightThumbstick.xAxis.value), @"tilt": @(p.rightThumbstick.yAxis.value),
        @"stickX": @(p.leftThumbstick.xAxis.value), @"stickY": @(p.leftThumbstick.yAxis.value)
    };
    NSString *socket = slot.socketPath;
    NSString *path = [socket.stringByDeletingLastPathComponent stringByAppendingPathComponent:@"status.json"];
    NSData *data = [NSJSONSerialization dataWithJSONObject:status options:0 error:nil];
    // Diagnostics must not block the game's input thread on disk I/O.
    static dispatch_queue_t queue;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ queue = dispatch_queue_create("macriff.status", DISPATCH_QUEUE_SERIAL); });
    dispatch_async(queue, ^{ [data writeToFile:path options:NSDataWritingAtomic error:nil]; });
}
static NSArray<GCController *> *(*originalControllers)(id, SEL);
static NSString *(*originalVendorName)(id, SEL);

static NSArray<GCController *> *controllers(id self, SEL selector) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{ fprintf(stderr, "[MacRiff Controller] Game queried the controller list.\n"); });
    NSArray *devices = originalControllers(self, selector);
    NSMutableArray *all = [devices mutableCopy] ?: [NSMutableArray array];
    for (MRSlot *slot in slots) if (![all containsObject:slot.guitar]) [all addObject:slot.guitar];
    return all;
}

static NSString *vendorName(id self, SEL selector) {
    for (MRSlot *slot in slots) if (self == slot.guitar) return slot.name;
    return originalVendorName(self, selector);
}

static void label(GCControllerElement *element, NSString *name) {
    element.localizedName = name;
    element.unmappedLocalizedName = name;
}

static void labelControls(MRSlot *slot) {
    GCExtendedGamepad *pad = slot.guitar.extendedGamepad;
    label(pad.buttonA, @"Green Fret");
    label(pad.buttonB, @"Red Fret");
    label(pad.buttonY, @"Yellow Fret");
    label(pad.buttonX, @"Blue Fret");
    label(pad.leftShoulder, @"Orange Fret");
    label(pad.buttonMenu, @"Start / Pause");
    label(pad.buttonOptions, @"Select / Star Power");
    label(pad.rightShoulder, @"Tilt / Star Power");
    label(pad.dpad.up, @"Strum Up");
    label(pad.dpad.down, @"Strum Down");
    label(pad.dpad.left, @"D-pad Left");
    label(pad.dpad.right, @"D-pad Right");
    label(pad.leftThumbstick, @"Riffmaster Joystick");
    label(pad.leftThumbstick.xAxis, @"Joystick X");
    label(pad.leftThumbstick.yAxis, @"Joystick Y");
    label(pad.leftThumbstickButton, @"Joystick Click");
    label(pad.rightThumbstick, @"Whammy / Tilt");
    label(pad.rightThumbstick.xAxis, @"Whammy");
    label(pad.rightThumbstick.yAxis, @"Tilt");
}

static float stickAxis(int16_t raw) {
    // Symmetric full range with a rescaled 12% deadzone to prevent menu drift.
    float value = raw < 0 ? (float)raw / 32768.0f : (float)raw / 32767.0f;
    float magnitude = fabsf(value);
    return magnitude <= 0.12f ? 0 : copysignf((magnitude - 0.12f) / 0.88f, value);
}

static void applyReport(MRSlot *slot, uint8_t buttons1, uint8_t buttons2, uint8_t whammy, uint8_t tilt,
                        uint8_t frets, bool click, int16_t stickX, int16_t stickY) {
    GCExtendedGamepad *pad = slot.guitar.extendedGamepad;
    [pad.buttonA setValue:(frets & 0x01) ? 1 : 0];
    [pad.buttonB setValue:(frets & 0x02) ? 1 : 0];
    [pad.buttonY setValue:(frets & 0x04) ? 1 : 0];
    [pad.buttonX setValue:(frets & 0x08) ? 1 : 0];
    [pad.leftShoulder setValue:(frets & 0x10) ? 1 : 0];
    [pad.buttonMenu setValue:(buttons1 & 0x04) ? 1 : 0];
    slot.tilted = tilt >= (slot.tilted ? 0x58 : 0x80);
    // Select's default binding activates Star Power, so tilt works without rebinding.
    [pad.buttonOptions setValue:((buttons1 & 0x08) || slot.tilted) ? 1 : 0];
    [pad.rightShoulder setValue:slot.tilted ? 1 : 0];
    float x = ((buttons2 & 0x08) ? 1.0f : 0.0f) - ((buttons2 & 0x04) ? 1.0f : 0.0f);
    float y = ((buttons2 & 0x01) ? 1.0f : 0.0f) - ((buttons2 & 0x02) ? 1.0f : 0.0f);
    [pad.dpad setValueForXAxis:x yAxis:y];
    [pad.leftThumbstick setValueForXAxis:stickAxis(stickX) yAxis:stickAxis(stickY)];
    [pad.leftThumbstickButton setValue:click ? 1 : 0];
    // Independent axes, zero at rest. Keep all 256 whammy/tilt levels.
    [pad.rightThumbstick setValueForXAxis:(float)whammy / 255.0f yAxis:(float)tilt / 255.0f];
}

static void configureGameInput(void) {
    static bool configured = false;
    if (configured) return;
    NSString *assemblyPath = [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/Frameworks/GameAssembly.dylib"];
    void *library = dlopen(assemblyPath.fileSystemRepresentation, RTLD_LAZY | RTLD_NOLOAD);
    if (!library) return;
    void *(*domainGet)(void) = dlsym(library, "il2cpp_domain_get");
    const void **(*assembliesGet)(void *, size_t *) = dlsym(library, "il2cpp_domain_get_assemblies");
    void *(*imageGet)(const void *) = dlsym(library, "il2cpp_assembly_get_image");
    void *(*classGet)(void *, const char *, const char *) = dlsym(library, "il2cpp_class_from_name");
    void *(*methodGet)(void *, const char *, int) = dlsym(library, "il2cpp_class_get_method_from_name");
    void *(*objectClass)(void *) = dlsym(library, "il2cpp_object_get_class");
    void *(*unbox)(void *) = dlsym(library, "il2cpp_object_unbox");
    void *(*invoke)(void *, void *, void **, void **) = dlsym(library, "il2cpp_runtime_invoke");
    if (!domainGet || !assembliesGet || !imageGet || !classGet || !methodGet || !objectClass || !unbox || !invoke) {
        fprintf(stderr, "[MacRiff Controller] Game runtime does not expose the required configuration API.\n");
        dlclose(library);
        return;
    }
    void *domain = domainGet();
    if (!domain) { dlclose(library); return; }
    size_t assemblyCount = 0;
    const void **assemblies = assembliesGet(domain, &assemblyCount);
    void *reInput = NULL;
    for (size_t i = 0; i < assemblyCount && !reInput; i++) reInput = classGet(imageGet(assemblies[i]), "Rewired", "ReInput");
    if (!reInput) { dlclose(library); return; }
    void *readyMethod = methodGet(reInput, "get_isReady", 0);
    void *configMethod = methodGet(reInput, "get_configuration", 0);
    void *exception = NULL;
    void *ready = readyMethod ? invoke(readyMethod, NULL, NULL, &exception) : NULL;
    if (exception || !ready || !*(bool *)unbox(ready) || !configMethod) { dlclose(library); return; }
    void *config = invoke(configMethod, NULL, NULL, &exception);
    if (exception || !config) { dlclose(library); return; }
    void *configClass = objectClass(config);
    void *getEnabled = methodGet(configClass, "get_useAppleGameControllerFramework", 0);
    void *setEnabled = methodGet(configClass, "set_useAppleGameControllerFramework", 1);
    void *enabled = getEnabled ? invoke(getEnabled, config, NULL, &exception) : NULL;
    if (exception || !enabled || !setEnabled) {
        fprintf(stderr, "[MacRiff Controller] Could not access the game's GameController configuration.\n");
        dlclose(library);
        return;
    }
    bool current = *(bool *)unbox(enabled);
    fprintf(stderr, "[MacRiff Controller] GameController backend enabled before setup=%s.\n", current ? "yes" : "no");
    if (!current) {
        bool value = true;
        void *arguments[] = {&value};
        invoke(setEnabled, config, arguments, &exception);
        if (exception) {
            fprintf(stderr, "[MacRiff Controller] Game rejected the GameController configuration change.\n");
            dlclose(library);
            return;
        }
        fprintf(stderr, "[MacRiff Controller] Enabled GameController backend for this game session.\n");
    }
    configured = true;
    dlclose(library);
}

static void auditGameDetection(void) {
    configureGameInput();
    NSString *plugin = [NSBundle.mainBundle.bundlePath stringByAppendingPathComponent:@"Contents/PlugIns/Rewired_MacOS.bundle"];
    void *library = dlopen(plugin.fileSystemRepresentation, RTLD_LAZY | RTLD_NOLOAD);
    if (!library) {
        fprintf(stderr, "[MacRiff Controller] Rewired plugin has not been loaded by the game.\n");
        return;
    }
    int (*count)(void) = dlsym(library, "RWController_GetCount");
    void *(*atIndex)(unsigned) = dlsym(library, "RWController_GetAtIndex");
    GCController *(*controller)(void *) = dlsym(library, "RWController_GetGCControllerPointer");
    if (count && atIndex && controller) {
        int total = count();
        for (MRSlot *slot in slots) {
            bool detected = false;
            for (int i = 0; i < total; i++) if (controller(atIndex(i)) == slot.guitar) detected = true;
            slot.gameDetected = detected;
            publishStatus(slot, slot.bridgeConnected, true);
            fprintf(stderr, "[MacRiff Controller] %s: MacRiff detected=%s.\n", slot.name.UTF8String, detected ? "yes" : "no");
        }
    }
    dlclose(library);
}

static void *readReports(void *context) {
    @autoreleasepool {
        MRSlot *slot = (__bridge MRSlot *)context;
        const char *socketPath = slot.socketPath.fileSystemRepresentation;
        int listener = socket(AF_UNIX, SOCK_STREAM, 0);
        struct sockaddr_un address = {0};
        address.sun_family = AF_UNIX;
        strlcpy(address.sun_path, socketPath, sizeof(address.sun_path));
        address.sun_len = (uint8_t)(offsetof(struct sockaddr_un, sun_path) + strlen(address.sun_path) + 1);
        // The launcher creates a new private directory. Never replace a socket.
        if (listener < 0 || bind(listener, (struct sockaddr *)&address, address.sun_len) < 0 ||
            chmod(socketPath, 0600) < 0 || listen(listener, 1) < 0) {
            fprintf(stderr, "[MacRiff Controller] Cannot open private socket: %s\n", strerror(errno));
            if (listener >= 0) close(listener);
            return NULL;
        }
        fprintf(stderr, "[MacRiff Controller] Ready: %s\n", socketPath);
        for (;;) {
            int client = accept(listener, NULL, NULL);
            if (client < 0) { if (errno == EINTR) continue; break; }
            uid_t peerUID;
            gid_t peerGID;
            if (getpeereid(client, &peerUID, &peerGID) != 0 ||
                (peerUID != 0 && peerUID != getuid())) {
                close(client);
                continue;
            }
            fprintf(stderr, "[MacRiff Controller] Guitar bridge connected.\n");
            // Reader sends a heartbeat every 500ms, even when no controls change.
            struct timeval timeout = {.tv_sec = 3, .tv_usec = 0};
            setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
            uint8_t report[16];
            size_t used = 0;
            unsigned loggedChanges = 0;
            uint16_t previousButtons = 0xffff;
            for (;;) {
                ssize_t size = read(client, report + used, sizeof(report) - used);
                if (size < 0 && errno == EINTR) continue;
                if (size <= 0) break;
                used += (size_t)size;
                if (used != sizeof(report)) continue;
                if (memcmp(report, "MRFH", 4) == 0) {
                    dispatch_sync(dispatch_get_main_queue(), ^{
                        slot.transportConnected = true;
                        publishStatus(slot, slot.bridgeConnected, true);
                    });
                    used = 0;
                    continue;
                }
                if (memcmp(report, "MRF2", 4) != 0) break;
                uint8_t b1 = report[4], b2 = report[5], whammy = report[6], tilt = report[7];
                uint8_t frets = report[8];
                bool click = report[9] != 0;
                int16_t stickX = (int16_t)((uint16_t)report[10] | ((uint16_t)report[11] << 8));
                int16_t stickY = (int16_t)((uint16_t)report[12] | ((uint16_t)report[13] << 8));
                dispatch_sync(dispatch_get_main_queue(), ^{
                    applyReport(slot, b1, b2, whammy, tilt, frets, click, stickX, stickY);
                    slot.bridgeConnected = true;
                    slot.transportConnected = true;
                    slot.lastInput = NSDate.date.timeIntervalSince1970;
                    slot.reportCount++;
                    uint32_t previousObserved = slot.observedControls;
                    slot.observedControls |= frets | ((b2 & 3) << 5) | (whammy > 32 ? 1 << 7 : 0) |
                        (tilt >= 0x80 ? 1 << 8 : 0) | (abs(stickX) > 8000 ? 1 << 9 : 0) |
                        (abs(stickY) > 8000 ? 1 << 10 : 0) | (click ? 1 << 11 : 0) |
                        ((b1 & 4) ? 1 << 12 : 0) | ((b1 & 8) ? 1 << 13 : 0);
                    publishStatus(slot, true, slot.reportCount == 1 || previousObserved != slot.observedControls);
                });
                uint16_t buttons = ((uint16_t)frets << 8) | b2 | b1;
                if (buttons != previousButtons && loggedChanges < 20) {
                    fprintf(stderr, "[MacRiff Controller] Delivered input: buttons=%04x whammy=%u tilt=%u.\n", buttons, whammy, tilt);
                    loggedChanges++;
                }
                previousButtons = buttons;
                used = 0;
            }
            close(client);
            dispatch_sync(dispatch_get_main_queue(), ^{ applyReport(slot, 0, 0, 0, 0, 0, false, 0, 0); slot.bridgeConnected = false; slot.transportConnected = false; publishStatus(slot, false, true); });
            fprintf(stderr, "[MacRiff Controller] Bridge disconnected; all buttons released.\n");
        }
        close(listener);
    }
    return NULL;
}

__attribute__((constructor)) static void startController(void) {
    @autoreleasepool {
        NSArray *configuration;
        const char *configPath = getenv("MACRIFF_CONTROLLER_CONFIG");
        if (configPath) {
            NSData *data = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:configPath]];
            id json = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            configuration = [json isKindOfClass:NSArray.class] ? json : nil;
        } else {
            const char *path = getenv("MACRIFF_CONTROLLER_SOCKET");
            if (path) configuration = @[@{@"socket": [NSString stringWithUTF8String:path], @"name": @"MacRiff Riffmaster"}];
        }
        if (!configuration.count || configuration.count > 4) {
            fprintf(stderr, "[MacRiff Controller] Expected between 1 and 4 bridge slots.\n");
            return;
        }
        NSMutableArray *created = [NSMutableArray array];
        NSMutableSet *paths = [NSMutableSet set];
        for (id item in configuration) {
            if (![item isKindOfClass:NSDictionary.class]) return;
            NSString *path = item[@"socket"], *name = item[@"name"];
            if (![path isKindOfClass:NSString.class] || ![name isKindOfClass:NSString.class] ||
                !path.length || !name.length || strlen(path.fileSystemRepresentation) >= sizeof(((struct sockaddr_un *)0)->sun_path) || [paths containsObject:path]) return;
            [paths addObject:path];
            MRSlot *slot = [MRSlot new];
            slot.socketPath = path;
            slot.name = name;
            slot.guitar = [GCController controllerWithExtendedGamepad];
            if (!slot.guitar) return;
            labelControls(slot);
            applyReport(slot, 0, 0, 0, 0, 0, false, 0, 0);
            [created addObject:slot];
        }
        slots = [created copy];
        Method enumeration = class_getClassMethod(GCController.class, @selector(controllers));
        originalControllers = (void *)method_setImplementation(enumeration, (IMP)controllers);
        Method name = class_getInstanceMethod(GCController.class, @selector(vendorName));
        originalVendorName = (void *)method_setImplementation(name, (IMP)vendorName);
        for (MRSlot *slot in slots) {
            pthread_t thread;
            int error = pthread_create(&thread, NULL, readReports, (__bridge void *)slot);
            if (error == 0) pthread_detach(thread);
            else fprintf(stderr, "[MacRiff Controller] Reader thread failed: %s\n", strerror(error));
        }
        fprintf(stderr, "[MacRiff Controller] Installed %lu independent controller(s).\n", (unsigned long)slots.count);
        for (int seconds = 5; seconds <= 30; seconds += 5) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)seconds * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ auditGameDetection(); });
        }
    }
}
