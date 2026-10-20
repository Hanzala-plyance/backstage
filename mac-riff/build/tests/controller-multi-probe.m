#import <Foundation/Foundation.h>
#import <GameController/GameController.h>
#include <assert.h>
#include <dlfcn.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
static void connection(void *p) {}
static void pump(void) { [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]]; }
static int connectSlot(NSString *path) {
    int fd=socket(AF_UNIX,SOCK_STREAM,0); assert(fd>=0);
    struct sockaddr_un a={0}; a.sun_family=AF_UNIX;
    strlcpy(a.sun_path,path.fileSystemRepresentation,sizeof(a.sun_path));
    bool ok=false;
    for(int n=0;n<30;n++){ if(connect(fd,(struct sockaddr*)&a,sizeof(a))==0){ok=true;break;} pump(); }
    assert(ok);return fd;
}
static void sendFrame(int fd,uint8_t frets,uint8_t tilt) {
    uint8_t bytes[]={'M','R','F','2',0,0,0,tilt,frets,0,0,0,0,0,0,0};
    assert(write(fd,bytes,5)==5);assert(write(fd,bytes+5,11)==11);pump();
}
static unsigned mask(GCExtendedGamepad *p) { return p.buttonA.pressed | (p.buttonB.pressed<<1) | (p.buttonY.pressed<<2) | (p.buttonX.pressed<<3) | (p.leftShoulder.pressed<<4); }
int main(int argc,const char **argv){ @autoreleasepool {
    assert(argc==2);
    NSData *data=[NSData dataWithContentsOfFile:[NSString stringWithUTF8String:getenv("MACRIFF_CONTROLLER_CONFIG")]];
    NSArray *config=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];assert(config.count==4);
    NSMutableArray<GCController*> *guitars=[NSMutableArray array];
    for(NSDictionary *entry in config){
        GCController *found=nil;
        for(GCController *g in GCController.controllers) if([g.vendorName isEqualToString:entry[@"name"]]) found=g;
        assert(found);[guitars addObject:found];
    }
    void *library=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);assert(library);
    bool(*initialize)(void(*)(void*),void(*)(void*))=dlsym(library,"Initialize");
    void(*update)(void)=dlsym(library,"Update");
    int(*count)(void)=dlsym(library,"RWController_GetCount");
    void*(*at)(unsigned)=dlsym(library,"RWController_GetAtIndex");
    GCController*(*gc)(void*)=dlsym(library,"RWController_GetGCControllerPointer");
    void(*dispose)(void)=dlsym(library,"Dispose");
    assert(initialize(connection,connection));pump();update();assert(count()>=4);
    for(GCController *g in guitars){bool found=false;for(int i=0;i<count();i++) if(gc(at(i))==g)found=true;assert(found);}
    int fds[4]; for(int i=0;i<4;i++) fds[i]=connectSlot(config[i][@"socket"]);
    for(int i=0;i<4;i++){
        sendFrame(fds[i],1<<i,i==0?200:0);update();
        for(int j=0;j<4;j++)assert(mask(guitars[j].extendedGamepad)==(j<=i?1<<j:0));
    }
    assert(guitars[0].extendedGamepad.rightShoulder.pressed);
    for(int i=1;i<4;i++) assert(!guitars[i].extendedGamepad.rightShoulder.pressed);
    close(fds[1]);pump();update();assert(mask(guitars[1].extendedGamepad)==0);
    assert(mask(guitars[0].extendedGamepad)==1 && mask(guitars[2].extendedGamepad)==4 && mask(guitars[3].extendedGamepad)==8);
    fds[1]=connectSlot(config[1][@"socket"]);sendFrame(fds[1],16,0);update();assert(mask(guitars[1].extendedGamepad)==16);
    for(int i=0;i<4;i++){
        NSString *file=[[config[i][@"socket"] stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"status.json"];
        NSDictionary *s=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:file] options:0 error:nil];
        assert([s[@"reports"] intValue]==(i==1?2:1));
        close(fds[i]);
    }
    pump();dispose();puts("PASS: four controllers in Rewired, independent frets/tilt/status, isolated disconnect and reconnect.");
}return 0;}
