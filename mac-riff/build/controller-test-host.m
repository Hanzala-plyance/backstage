// Runs the exact same input adapter as the game, without launching a game.
#import <Foundation/Foundation.h>
#include <signal.h>
#include <unistd.h>
int main(void) {
    @autoreleasepool {
        // Prevent an orphaned tester from holding USB access after Setup exits.
        pid_t owner = getppid();
        if (owner <= 1) return 0;
        [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) {
            if (getppid() != owner || kill(owner, 0) != 0) exit(0);
        }];
        [[NSRunLoop currentRunLoop] run];
    }
    return 0;
}
