import { getIpregistry } from '@ipregistry/next'
import type { GetServerSideProps } from 'next'

interface Props {
    country: string | null
    inEu: boolean
}

export const getServerSideProps: GetServerSideProps<Props> = async ({
    req,
}) => {
    const { data } = await getIpregistry(req)

    return {
        props: {
            country: data?.location?.country?.name ?? null,
            inEu: data?.location?.in_eu ?? false,
        },
    }
}

export default function Home({ country, inEu }: Props) {
    return (
        <main>
            <h1>Hello {country ? `visitor from ${country}` : 'visitor'}!</h1>
            {inEu && <p>This site uses cookies. [Accept] [Decline]</p>}
        </main>
    )
}
