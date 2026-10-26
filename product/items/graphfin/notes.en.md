# GraphFin

A graph database, with time attached.

Real data is usually both connected and changing. A company is tied to suppliers, subsidiaries, securities and funds; the same objects also carry prices, holdings and share counts that keep moving. Those two problems normally live in two systems: the graph database knows what is connected, the time-series store knows what changed and when, and the application in between is left to keep identities aligned, coordinate reads and writes, and stay consistent.

GraphFin puts both inside one transaction. Relationships are first-class, observations hang off an object or a relationship, and a read can cross the two.

## What it does today

- **Start from one object and follow the edges.** Walk the relationships to related records without writing a wall of joins, and without flattening the graph into edge tables and rebuilding it.
- **Attach time series to an object.** Prices, temperatures, ownership ratios live in that object's own history; a range query is one read with a time predicate.
- **Start from a single binary.** No external store, no coordination service. Unpack it and run it locally, and look at real output before talking about deployment.
- **Read and write inside one transaction.** A graph change and its history either both take effect or neither does.

## What it does not do yet

Version 0.1.0, alpha.

No distribution, no fine-grained permissions, no online backup — backup means stopping the process and copying files. The data size and concurrency limits of one node are being measured; when the numbers exist they go into the research ledger instead of being guessed here. So the honest sentence is: **it runs, it is ready to evaluate, and it is not for production yet.**

## Why open source

Apache 2.0.

The engine starts from TuGraph 4.5.2: what was kept, what was rewritten, and why, is recorded in the repository — including the parts that turned out not to be worth it. The mistakes stay in the history too. Delete them and the next person makes them again.
