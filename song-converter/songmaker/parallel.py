"""Independent conversion stages with monotonic progress and bounded workers."""
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import perf_counter


def run_stages(tasks: dict, progress):
    weights = {'Charts': 32, 'Lyrics': 35, 'Artwork': 7}
    fractions = {name: 0.0 for name in tasks}
    statuses = {name: 'starting' for name in tasks}
    lock = Lock()
    timings = {}

    def run(name, task):
        started = perf_counter()
        def report(fraction, message):
            with lock:
                fractions[name] = max(fractions[name], min(1.0, fraction))
                statuses[name] = message
                percent = 18 + int(sum(fractions[k] * weights.get(k, 0) for k in tasks))
                progress(percent, ' · '.join(f'{k}: {statuses[k]}' for k in tasks))
        result = task(report)
        timings[name] = round(perf_counter() - started, 2)
        report(1, 'ready')
        return result

    with ThreadPoolExecutor(max_workers=len(tasks), thread_name_prefix='song-stage') as executor:
        futures = {name: executor.submit(run, name, task) for name, task in tasks.items()}
        results = {name: future.result() for name, future in futures.items()}
    return results, timings
