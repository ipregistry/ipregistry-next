import { getIpregistry, isEuVisitor } from '@ipregistry/next'

export default async function Page() {
    const context = await getIpregistry()
    const { data } = context

    return (
        <main>
            <h1>
                Hello{' '}
                {data?.location?.city
                    ? `visitor from ${data.location.city}`
                    : 'visitor'}
                !
            </h1>

            {data?.currency?.code && <p>Prices shown in {data.currency.code}.</p>}

            {isEuVisitor(context) && (
                <aside>
                    {/* Only EU visitors see the consent banner. */}
                    <p>This site uses cookies. [Accept] [Decline]</p>
                </aside>
            )}
        </main>
    )
}
