import {ObservableValue, isDefined, Nullable, Subscription} from "@opendaw/lib-std"

export const subscribeFavicon = (observable: ObservableValue<Nullable<unknown>>): Subscription => {
    return observable.catchupAndSubscribe(owner => {
        const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
        if (isDefined(link)) {
            link.href = isDefined(owner.getValue()) ? "/flowtu-icon-live.png" : "/flowtu-icon.png"
        }
    })
}

