#import <Foundation/Foundation.h>
#import <GameController/GameController.h>
#include <assert.h>
#include <dlfcn.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

static void connected(void *device) { printf("Rewired detected controller %p\n", device); }
static void disconnected(void *device) {}
static void pump(void) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
}
static void sendReport(int socket, uint8_t b1, uint8_t b2, uint8_t whammy, uint8_t tilt, uint8_t frets, int16_t x, int16_t y) {
    uint8_t data[] = {'M','R','F','2',b1,b2,whammy,tilt,frets,1, x & 255, (x >> 8) & 255, y & 255, (y >> 8) & 255,0,0};
    // Exercise the receiver's stream framing, including a split report.
    assert(write(socket, data, 3) == 3);
    assert(write(socket, data + 3, sizeof(data) - 3) == sizeof(data) - 3);
    pump();
}

int main(int argc, const char **argv) { @autoreleasepool {
    assert(argc == 2);
    GCController *guitar = nil;
    for (GCController *device in [GCController controllers]) {
        if ([device.vendorName isEqualToString:@"MacRiff Riffmaster"]) guitar = device;
    }
    assert(guitar && guitar.isSnapshot);
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!library) { fprintf(stderr, "%s\n", dlerror()); return 1; }
    bool (*initialize)(void (*)(void *), void (*)(void *)) = dlsym(library, "Initialize");
    void (*update)(void) = dlsym(library, "Update");
    int (*count)(void) = dlsym(library, "RWController_GetCount");
    void *(*atIndex)(unsigned) = dlsym(library, "RWController_GetAtIndex");
    GCController *(*gcController)(void *) = dlsym(library, "RWController_GetGCControllerPointer");
    void (*dispose)(void) = dlsym(library, "Dispose");
    assert(initialize && update && count && atIndex && gcController && dispose);
    assert(initialize(connected, disconnected));
    pump(); update();
    bool found = false;
    for (int i = 0; i < count(); i++) if (gcController(atIndex(i)) == guitar) found = true;
    assert(found);
    printf("PASS: Clone Hero's Rewired library sees the MacRiff controller.\n");

    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    assert(fd >= 0);
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    strlcpy(address.sun_path, getenv("MACRIFF_CONTROLLER_SOCKET"), sizeof(address.sun_path));
    bool didConnect = false;
    for (int i = 0; i < 20; i++) {
        if (connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0) { didConnect = true; break; }
        pump();
    }
    assert(didConnect);
    GCExtendedGamepad *pad = guitar.extendedGamepad;
    sendReport(fd, 0, 0x01, 0xff, 0x94, 0x1f, -32768, 32767);
    update();
    assert(pad.buttonA.pressed && pad.buttonB.pressed && pad.buttonY.pressed);
    assert(pad.buttonX.pressed && pad.leftShoulder.pressed);
    assert(pad.dpad.up.pressed && !pad.dpad.down.pressed && pad.rightShoulder.pressed);
    assert(fabsf(pad.leftThumbstick.xAxis.value + 1.0f) < 0.001f);
    assert(fabsf(pad.leftThumbstick.yAxis.value - 1.0f) < 0.001f);
    assert(fabsf(pad.rightThumbstick.xAxis.value - 1.0f) < 0.001f);
    assert(pad.buttonOptions.pressed && pad.leftThumbstickButton.pressed);
    assert([pad.buttonA.localizedName isEqualToString:@"Green Fret"]);
    printf("Whammy axis name: %s\n", pad.rightThumbstick.xAxis.localizedName.UTF8String);
    sendReport(fd, 0, 0, 128, 0x70, 0, 0, 0);
    assert(pad.rightShoulder.pressed); // Hysteresis holds through threshold noise.
    assert(fabsf(pad.rightThumbstick.xAxis.value - 128.0f / 255) < 0.001f);
    sendReport(fd, 0x0c, 0x02, 0x00, 0x20, 0, 100, -100);
    update();
    assert(!pad.buttonA.pressed && !pad.buttonB.pressed && !pad.buttonY.pressed);
    assert(!pad.buttonX.pressed && !pad.leftShoulder.pressed && !pad.rightShoulder.pressed);
    assert(pad.dpad.down.pressed && !pad.dpad.up.pressed);
    assert(pad.buttonMenu.pressed && pad.buttonOptions.pressed);
    assert(pad.leftThumbstick.xAxis.value == 0 && pad.leftThumbstick.yAxis.value == 0);
    assert(pad.rightThumbstick.xAxis.value == 0);
    close(fd);
    pump(); update();
    assert(!pad.dpad.down.pressed && !pad.buttonMenu.pressed && !pad.buttonOptions.pressed);
    assert(pad.rightThumbstick.yAxis.value == 0 && !pad.leftThumbstickButton.pressed);
    printf("PASS: all frets, chords, strum, tilt, menu buttons, whammy, and disconnect release.\n");
    dispose();
    return 0;
} }
