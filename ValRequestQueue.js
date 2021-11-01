// Currently Unused
class ValRequestQueue {
    constructor(interval) {
        this.interval = interval;
        this.requests = [];
        this.process();
    }

    async process() {
        if (this.requests.length > 0) {
            const req = this.requests.shift();
            let failed = false;
            let data;

            try {
                data = await req.action();
            } catch (e) {
                failed = true;
                req.tries++;
                if (req.tries <= 5) {
                    this.requests.push(req);
                } else {
                    req.reject('too many retries');
                }
            }

            if (!failed) {
                req.resolve(data);
            }
        }
        setTimeout(this.process, this.interval);
    }

    async request(func) {
        return new Promise((resolve, reject) => {
            this.requests.push({
                action: func,
                tries: 0,
                resolve,
                reject
            });
        });
    }
}

module.exports = ValRequestQueue;
