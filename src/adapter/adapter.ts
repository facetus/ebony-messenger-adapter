import { GenericAdapter, User } from 'ebony-framework';
import { UserModel } from 'ebony-framework/build/adapter'
import { Request, Response, RequestHandler } from 'express';

import webhook from './webhook';
import { senderFactory } from './sender';
import messagingWebhook from '../webhooks/messaging';
import MessengerUser from './MessengerUser';
import { SendAPIBody, UserDataFields } from './interfaces/messengerAPI';

export interface MessengerWebhookOptions<T extends MessengerUser> {
    webhookKey?: string;
    route?: string;
    pageId: string;
    appSecret: string;
    pageToken: string;
    userModel?: UserModel<T>
}

export default class MessengerAdapter<T extends MessengerUser> extends GenericAdapter<T> {
    private webhookKey: string;
    private appSecret: string;
    private pageToken: string;
    private route: string;
    private pageId: string;
    
    public sender: (...params: any[]) => Promise<void>;
    public startsTyping: (id: string) => Promise<void>;
    public stopsTyping: (id: string) => Promise<void>;
    public markSeen: (id: string) => Promise<void>;
    public getUserData: (id: string, fields: UserDataFields[]) => Promise<void>;
    public handover: (id: string) => Promise<void>;

    constructor(options: MessengerWebhookOptions<T>, sendFunction?: (body: SendAPIBody, ...params: any[]) => Promise<any>) {
        const { route = '/fb', webhookKey = 'ebony123', pageId, pageToken, appSecret, userModel = MessengerUser } = options;

        super('messenger', userModel);
        this.webhookKey = webhookKey;
        this.appSecret = appSecret;
        this.pageToken = pageToken;
        this.pageId = pageId;
        this.route = route;
        const { send, senderAction, getUserData, handover } = senderFactory(pageToken, sendFunction);

        this.sender = send;
        this.startsTyping = (id: string) => senderAction(id, "typing_on");
        this.stopsTyping = (id: string) => senderAction(id, "typing_on");
        this.markSeen = (id: string) => senderAction(id, "mark_seen");
        this.getUserData = getUserData;
        this.handover = handover;
    }

    initWebhook() {
        const messaging = messagingWebhook({ userLoader: this.userLoader(), routers: this.routers, handlers: this.handlers });

        // Facebook specific endpoints
        this.webhook.get(this.route, this.validationEndpoint());
        this.webhook.post(this.route, webhook(this.pageId, { messaging }));
    }

    private validationEndpoint(): RequestHandler {
        const webhookKey = this.webhookKey;

        return (req: Request, res: Response) => {
            if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === webhookKey) {
                console.log("Validating webhook");
                return res.status(200).send(req.query['hub.challenge']);
            }

            console.error("Failed validation. Make sure the validation tokens match.");
            return res.sendStatus(400);
        }
    }

    public userLoader(): (id: string) => Promise<T> {
        return async (id: string) => {
            try {
                const userData = await User.findByProviderId(id);
                if (!userData) {
                    const newUser = new this.userModel({
                        id,
                        provider: this.providerName
                    }, this.pageToken) as T;
                    await newUser.getFacebookData();
                    await newUser.save();

                    return newUser;
                }
                
                return new MessengerUser(userData, this.pageToken) as T;
            } catch (err) {
                throw err;
            }
        }
    }

}

