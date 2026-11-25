import {EffectFactories, type EffectFactory} from '@opendaw/studio-core'

export const effectMenuLabel = (factory: EffectFactory) =>
    factory === EffectFactories.Revamp ? 'Parametric EQ (Revamp)' : factory.defaultName

export const audioInsertList = [
    EffectFactories.Revamp, ...EffectFactories.AudioList.filter(factory => factory !== EffectFactories.Revamp)
]
