import {ObservableValue, isDefined, Nullable, Subscription} from "@opendaw/lib-std"

export const subscribeFavicon = (observable: ObservableValue<Nullable<unknown>>): Subscription => {
    return observable.catchupAndSubscribe(owner => {
        const link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
        if (isDefined(link)) {
            link.href = isDefined(owner.getValue()) ? `${import.meta.env.BASE_URL}flowtu-icon-live.png` : `${import.meta.env.BASE_URL}flowtu-icon.png`
        }
    })
}

